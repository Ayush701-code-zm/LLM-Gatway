"""Ollama provider adapter."""

from __future__ import annotations

import json
import time

import httpx

from smartroute.config import settings
from smartroute.config.logger import logger
from smartroute.providers.interface import LLMProvider
from smartroute.types.gateway import LLMRequest, LLMResponse, LLMStreamChunk, ProviderHealthResult


class OllamaProvider(LLMProvider):
    name = "OLLAMA"

    def __init__(self) -> None:
        self.base_url = settings.OLLAMA_BASE_URL.rstrip("/")

    @property
    def is_configured(self) -> bool:
        return bool(self.base_url)

    async def generate(self, request: LLMRequest) -> LLMResponse:
        start = time.time()
        body = {
            "model": request.model,
            "messages": [{"role": m.role, "content": m.content} for m in request.messages],
            "stream": False,
            "options": {
                "num_predict": request.max_tokens or 2048,
                "temperature": request.temperature if request.temperature is not None else 0.7,
            },
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            res = await client.post(f"{self.base_url}/api/chat", json=body)

        if res.status_code >= 400:
            raise RuntimeError(f"Ollama error {res.status_code}: {res.text}")

        data = res.json()
        return LLMResponse(
            content=data.get("message", {}).get("content", ""),
            input_tokens=data.get("prompt_eval_count", 0),
            output_tokens=data.get("eval_count", 0),
            finish_reason="stop",
            latency_ms=int((time.time() - start) * 1000),
            model=data.get("model", request.model),
            provider=self.name,
            raw_response=data,
        )

    async def stream(self, request: LLMRequest, on_chunk) -> LLMResponse:
        start = time.time()
        body = {
            "model": request.model,
            "messages": [{"role": m.role, "content": m.content} for m in request.messages],
            "stream": True,
            "options": {
                "num_predict": request.max_tokens or 2048,
                "temperature": request.temperature if request.temperature is not None else 0.7,
            },
        }

        full_content = ""
        input_tokens = 0
        output_tokens = 0

        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("POST", f"{self.base_url}/api/chat", json=body) as res:
                if res.status_code >= 400:
                    raise RuntimeError(f"Ollama stream error {res.status_code}")
                async for line in res.aiter_lines():
                    if not line:
                        continue
                    data = json.loads(line)
                    content = data.get("message", {}).get("content")
                    if content:
                        full_content += content
                        result = on_chunk(LLMStreamChunk(content=content, done=False))
                        if result is not None:
                            await result
                    if data.get("done"):
                        input_tokens = data.get("prompt_eval_count", 0)
                        output_tokens = data.get("eval_count", 0)
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
        raise RuntimeError("Use OpenAI for embedding generation.")

    def calculate_cost(self, input_tokens: int, output_tokens: int, model: str) -> float:
        return 0.0

    async def health_check(self, model: str) -> ProviderHealthResult:
        start = time.time()
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                res = await client.get(f"{self.base_url}/api/tags")
            if res.status_code >= 400:
                raise RuntimeError(f"Status {res.status_code}")
            return ProviderHealthResult(
                provider=self.name,
                model=model,
                status="available",
                latency_ms=int((time.time() - start) * 1000),
            )
        except Exception as exc:
            logger.warn("ollama_health_check_failed", err=str(exc), model=model)
            return ProviderHealthResult(
                provider=self.name,
                model=model,
                status="unavailable",
                latency_ms=int((time.time() - start) * 1000),
                error_message=str(exc),
            )
