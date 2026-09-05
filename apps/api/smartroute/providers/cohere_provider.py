"""Cohere provider adapter."""

from __future__ import annotations

import json
import time

import httpx

from smartroute.config import settings
from smartroute.config.logger import logger
from smartroute.providers.interface import LLMProvider
from smartroute.types.gateway import LLMMessage, LLMRequest, LLMResponse, LLMStreamChunk, ProviderHealthResult

MODEL_COSTS: dict[str, dict[str, float]] = {
    "command-r-plus-08-2024": {"input": 3.0, "output": 15.0},
    "command-r-08-2024": {"input": 0.5, "output": 1.5},
    "command-r7b-12-2024": {"input": 0.3, "output": 0.6},
    "command-light": {"input": 0.3, "output": 0.6},
    "embed-english-v3.0": {"input": 0.1, "output": 0.0},
}


class CohereProvider(LLMProvider):
    name = "COHERE"
    base_url = "https://api.cohere.com/v2"

    def __init__(self) -> None:
        self._api_key = settings.COHERE_API_KEY

    @property
    def is_configured(self) -> bool:
        return bool(self._api_key)

    def _assert_configured(self) -> str:
        if not self._api_key:
            raise RuntimeError("Cohere API key not configured")
        return self._api_key

    def _build_messages(self, messages: list[LLMMessage]) -> list[dict[str, str]]:
        return [
            {
                "role": "assistant" if m.role == "assistant" else "system" if m.role == "system" else "user",
                "content": m.content,
            }
            for m in messages
        ]

    async def generate(self, request: LLMRequest) -> LLMResponse:
        api_key = self._assert_configured()
        start = time.time()

        async with httpx.AsyncClient(timeout=120.0) as client:
            res = await client.post(
                f"{self.base_url}/chat",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": request.model,
                    "messages": self._build_messages(request.messages),
                    "max_tokens": request.max_tokens or 2048,
                    "temperature": request.temperature if request.temperature is not None else 0.7,
                },
            )

        if res.status_code >= 400:
            raise RuntimeError(f"Cohere error {res.status_code}: {res.text}")

        data = res.json()
        content = "".join(
            part.get("text", "")
            for part in data.get("message", {}).get("content", [])
            if part.get("type") == "text"
        )
        usage = data.get("usage", {}).get("billed_units", {})

        return LLMResponse(
            content=content,
            input_tokens=usage.get("input_tokens", 0),
            output_tokens=usage.get("output_tokens", 0),
            finish_reason="stop",
            latency_ms=int((time.time() - start) * 1000),
            model=request.model,
            provider=self.name,
            raw_response=data,
        )

    async def stream(self, request: LLMRequest, on_chunk) -> LLMResponse:
        api_key = self._assert_configured()
        start = time.time()
        full_content = ""
        input_tokens = 0
        output_tokens = 0

        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/chat",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": request.model,
                    "messages": self._build_messages(request.messages),
                    "max_tokens": request.max_tokens or 2048,
                    "temperature": request.temperature if request.temperature is not None else 0.7,
                    "stream": True,
                },
            ) as res:
                if res.status_code >= 400:
                    raise RuntimeError(f"Cohere stream error {res.status_code}")
                async for line in res.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if payload == "[DONE]":
                        continue
                    event = json.loads(payload)
                    delta = (
                        event.get("delta", {})
                        .get("message", {})
                        .get("content", {})
                        .get("text")
                    )
                    if delta:
                        full_content += delta
                        result = on_chunk(LLMStreamChunk(content=delta, done=False))
                        if result is not None:
                            await result
                    usage = event.get("usage", {}).get("billed_units", {})
                    if usage:
                        input_tokens = usage.get("input_tokens", input_tokens)
                        output_tokens = usage.get("output_tokens", output_tokens)

        result = on_chunk(LLMStreamChunk(content="", done=True, finish_reason="stop"))
        if result is not None:
            await result

        return LLMResponse(
            content=full_content,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            finish_reason="stop",
            latency_ms=int((time.time() - start) * 1000),
            model=request.model,
            provider=self.name,
        )

    async def generate_embedding(self, text: str, model: str) -> list[float]:
        api_key = self._assert_configured()
        async with httpx.AsyncClient(timeout=60.0) as client:
            res = await client.post(
                f"{self.base_url}/embed",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "texts": [text],
                    "input_type": "search_document",
                    "embedding_types": ["float"],
                },
            )
        if res.status_code >= 400:
            raise RuntimeError(f"Cohere embed error {res.status_code}: {res.text}")
        data = res.json()
        embedding = data.get("embeddings", {}).get("float", [None])[0]
        if not embedding:
            raise RuntimeError("Cohere returned no embedding")
        return embedding

    def calculate_cost(self, input_tokens: int, output_tokens: int, model: str) -> float:
        costs = MODEL_COSTS.get(model, {"input": 1.0, "output": 3.0})
        return (input_tokens / 1_000_000) * costs["input"] + (output_tokens / 1_000_000) * costs["output"]

    async def health_check(self, model: str) -> ProviderHealthResult:
        start = time.time()
        try:
            await self.generate(
                LLMRequest(model=model, messages=[LLMMessage(role="user", content="ping")], max_tokens=5)
            )
            return ProviderHealthResult(
                provider=self.name,
                model=model,
                status="available",
                latency_ms=int((time.time() - start) * 1000),
            )
        except Exception as exc:
            logger.warn("cohere_health_check_failed", err=str(exc), model=model)
            return ProviderHealthResult(
                provider=self.name,
                model=model,
                status="unavailable",
                latency_ms=int((time.time() - start) * 1000),
                error_message=str(exc),
            )
