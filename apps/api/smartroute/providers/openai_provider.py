"""OpenAI provider adapter."""

from __future__ import annotations

import time

from openai import AsyncOpenAI

from smartroute.config import settings
from smartroute.config.logger import logger
from smartroute.providers.interface import LLMProvider
from smartroute.types.gateway import LLMRequest, LLMResponse, LLMStreamChunk, ProviderHealthResult

MODEL_COSTS: dict[str, dict[str, float]] = {
    "gpt-4o": {"input": 2.5, "output": 10.0},
    "gpt-4o-mini": {"input": 0.15, "output": 0.6},
    "gpt-4-turbo": {"input": 10.0, "output": 30.0},
    "text-embedding-3-small": {"input": 0.02, "output": 0.0},
    "text-embedding-3-large": {"input": 0.13, "output": 0.0},
}


class OpenAIProvider(LLMProvider):
    name = "OPENAI"

    def __init__(self) -> None:
        self._client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY) if settings.OPENAI_API_KEY else None

    @property
    def is_configured(self) -> bool:
        return self._client is not None

    def _assert_configured(self) -> AsyncOpenAI:
        if not self._client:
            raise RuntimeError("OpenAI API key not configured")
        return self._client

    async def generate(self, request: LLMRequest) -> LLMResponse:
        client = self._assert_configured()
        start = time.time()

        completion = await client.chat.completions.create(
            model=request.model,
            messages=[{"role": m.role, "content": m.content} for m in request.messages],
            max_tokens=request.max_tokens,
            temperature=request.temperature,
            stream=False,
        )

        choice = completion.choices[0]
        usage = completion.usage
        return LLMResponse(
            content=choice.message.content or "",
            input_tokens=usage.prompt_tokens if usage else 0,
            output_tokens=usage.completion_tokens if usage else 0,
            finish_reason=choice.finish_reason or "stop",
            latency_ms=int((time.time() - start) * 1000),
            model=completion.model,
            provider=self.name,
            raw_response=completion,
        )

    async def stream(self, request: LLMRequest, on_chunk) -> LLMResponse:
        client = self._assert_configured()
        start = time.time()

        stream = await client.chat.completions.create(
            model=request.model,
            messages=[{"role": m.role, "content": m.content} for m in request.messages],
            max_tokens=request.max_tokens,
            temperature=request.temperature,
            stream=True,
            stream_options={"include_usage": True},
        )

        full_content = ""
        input_tokens = 0
        output_tokens = 0
        finish_reason = "stop"

        async for chunk in stream:
            delta = chunk.choices[0].delta.content if chunk.choices else None
            if delta:
                full_content += delta
                result = on_chunk(LLMStreamChunk(content=delta, done=False))
                if result is not None:
                    await result
            if chunk.choices and chunk.choices[0].finish_reason:
                finish_reason = chunk.choices[0].finish_reason
            if chunk.usage:
                input_tokens = chunk.usage.prompt_tokens
                output_tokens = chunk.usage.completion_tokens

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
        client = self._assert_configured()
        response = await client.embeddings.create(model=model, input=text)
        return list(response.data[0].embedding)

    def calculate_cost(self, input_tokens: int, output_tokens: int, model: str) -> float:
        costs = MODEL_COSTS.get(model, {"input": 0.0, "output": 0.0})
        return (input_tokens / 1_000_000) * costs["input"] + (output_tokens / 1_000_000) * costs["output"]

    async def health_check(self, model: str) -> ProviderHealthResult:
        start = time.time()
        try:
            await self.generate(
                LLMRequest(model=model, messages=[{"role": "user", "content": "ping"}], max_tokens=5)
            )
            return ProviderHealthResult(
                provider=self.name,
                model=model,
                status="available",
                latency_ms=int((time.time() - start) * 1000),
            )
        except Exception as exc:
            logger.warn("openai_health_check_failed", err=str(exc), model=model)
            return ProviderHealthResult(
                provider=self.name,
                model=model,
                status="unavailable",
                latency_ms=int((time.time() - start) * 1000),
                error_message=str(exc),
            )
