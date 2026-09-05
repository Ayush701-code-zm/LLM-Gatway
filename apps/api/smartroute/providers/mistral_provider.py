"""Mistral provider adapter."""

from __future__ import annotations

import json
import time

import httpx

from smartroute.config import settings
from smartroute.config.logger import logger
from smartroute.providers.interface import LLMProvider
from smartroute.types.gateway import LLMMessage, LLMRequest, LLMResponse, LLMStreamChunk, ProviderHealthResult

MODEL_COSTS: dict[str, dict[str, float]] = {
    "mistral-large-latest": {"input": 2.0, "output": 6.0},
    "mistral-small-latest": {"input": 0.2, "output": 0.6},
    "open-mistral-nemo": {"input": 0.15, "output": 0.15},
    "codestral-latest": {"input": 0.2, "output": 0.6},
}


class MistralProvider(LLMProvider):
    name = "MISTRAL"
    base_url = "https://api.mistral.ai/v1"

    def __init__(self) -> None:
        self._api_key = settings.MISTRAL_API_KEY

    @property
    def is_configured(self) -> bool:
        return bool(self._api_key)

    def _assert_configured(self) -> str:
        if not self._api_key:
            raise RuntimeError("Mistral API key not configured")
        return self._api_key

    async def generate(self, request: LLMRequest) -> LLMResponse:
        api_key = self._assert_configured()
        start = time.time()

        async with httpx.AsyncClient(timeout=120.0) as client:
            res = await client.post(
                f"{self.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": request.model,
                    "messages": [{"role": m.role, "content": m.content} for m in request.messages],
                    "max_tokens": request.max_tokens or 2048,
                    "temperature": request.temperature if request.temperature is not None else 0.7,
                    "stream": False,
                },
            )

        if res.status_code >= 400:
            raise RuntimeError(f"Mistral error {res.status_code}: {res.text}")

        data = res.json()
        choice = (data.get("choices") or [{}])[0]
        usage = data.get("usage", {})

        return LLMResponse(
            content=choice.get("message", {}).get("content", ""),
            input_tokens=usage.get("prompt_tokens", 0),
            output_tokens=usage.get("completion_tokens", 0),
            finish_reason=choice.get("finish_reason", "stop"),
            latency_ms=int((time.time() - start) * 1000),
            model=data.get("model", request.model),
            provider=self.name,
            raw_response=data,
        )

    async def stream(self, request: LLMRequest, on_chunk) -> LLMResponse:
        api_key = self._assert_configured()
        start = time.time()
        full_content = ""
        input_tokens = 0
        output_tokens = 0
        finish_reason = "stop"

        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": request.model,
                    "messages": [{"role": m.role, "content": m.content} for m in request.messages],
                    "max_tokens": request.max_tokens or 2048,
                    "temperature": request.temperature if request.temperature is not None else 0.7,
                    "stream": True,
                },
            ) as res:
                if res.status_code >= 400:
                    raise RuntimeError(f"Mistral stream error {res.status_code}")
                async for line in res.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if payload == "[DONE]":
                        continue
                    chunk = json.loads(payload)
                    delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content")
                    if delta:
                        full_content += delta
                        result = on_chunk(LLMStreamChunk(content=delta, done=False))
                        if result is not None:
                            await result
                    if chunk.get("choices", [{}])[0].get("finish_reason"):
                        finish_reason = chunk["choices"][0]["finish_reason"] or "stop"
                    if chunk.get("usage"):
                        input_tokens = chunk["usage"].get("prompt_tokens", input_tokens)
                        output_tokens = chunk["usage"].get("completion_tokens", output_tokens)

        result = on_chunk(LLMStreamChunk(content="", done=True, finish_reason=finish_reason))
        if result is not None:
            await result

        return LLMResponse(
            content=full_content,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            finish_reason=finish_reason,
            latency_ms=int((time.time() - start) * 1000),
            model=request.model,
            provider=self.name,
        )

    async def generate_embedding(self, text: str, model: str) -> list[float]:
        raise RuntimeError("Use OpenAI or Cohere for embedding generation.")

    def calculate_cost(self, input_tokens: int, output_tokens: int, model: str) -> float:
        costs = MODEL_COSTS.get(model, {"input": 0.5, "output": 1.5})
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
            logger.warn("mistral_health_check_failed", err=str(exc), model=model)
            return ProviderHealthResult(
                provider=self.name,
                model=model,
                status="unavailable",
                latency_ms=int((time.time() - start) * 1000),
                error_message=str(exc),
            )
