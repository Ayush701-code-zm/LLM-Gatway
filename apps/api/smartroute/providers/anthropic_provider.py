"""Anthropic provider adapter."""

from __future__ import annotations

import time

from anthropic import AsyncAnthropic

from smartroute.config import settings
from smartroute.config.logger import logger
from smartroute.providers.interface import LLMProvider
from smartroute.types.gateway import LLMMessage, LLMRequest, LLMResponse, LLMStreamChunk, ProviderHealthResult

MODEL_COSTS: dict[str, dict[str, float]] = {
    "claude-3-5-sonnet-20241022": {"input": 3.0, "output": 15.0},
    "claude-3-5-haiku-20241022": {"input": 0.8, "output": 4.0},
    "claude-3-haiku-20240307": {"input": 0.25, "output": 1.25},
    "claude-3-opus-20240229": {"input": 15.0, "output": 75.0},
}


class AnthropicProvider(LLMProvider):
    name = "ANTHROPIC"

    def __init__(self) -> None:
        self._client = (
            AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY) if settings.ANTHROPIC_API_KEY else None
        )

    @property
    def is_configured(self) -> bool:
        return self._client is not None

    def _assert_configured(self) -> AsyncAnthropic:
        if not self._client:
            raise RuntimeError("Anthropic API key not configured")
        return self._client

    def _split_messages(self, messages: list[LLMMessage]) -> tuple[str | None, list[dict[str, str]]]:
        system_message = next((m.content for m in messages if m.role == "system"), None)
        user_messages = [
            {"role": m.role, "content": m.content}
            for m in messages
            if m.role != "system"
        ]
        return system_message, user_messages

    async def generate(self, request: LLMRequest) -> LLMResponse:
        client = self._assert_configured()
        start = time.time()
        system_message, user_messages = self._split_messages(request.messages)

        response = await client.messages.create(
            model=request.model,
            max_tokens=request.max_tokens or 4096,
            system=system_message or None,
            messages=user_messages,  # type: ignore[arg-type]
        )

        text_block = next((b.text for b in response.content if b.type == "text"), "")
        return LLMResponse(
            content=text_block,
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
            finish_reason=response.stop_reason or "end_turn",
            latency_ms=int((time.time() - start) * 1000),
            model=response.model,
            provider=self.name,
            raw_response=response,
        )

    async def stream(self, request: LLMRequest, on_chunk) -> LLMResponse:
        client = self._assert_configured()
        start = time.time()
        system_message, user_messages = self._split_messages(request.messages)

        full_content = ""
        input_tokens = 0
        output_tokens = 0
        finish_reason = "end_turn"

        async with client.messages.stream(
            model=request.model,
            max_tokens=request.max_tokens or 4096,
            system=system_message or None,
            messages=user_messages,  # type: ignore[arg-type]
        ) as stream:
            async for event in stream:
                if event.type == "content_block_delta" and event.delta.type == "text_delta":
                    full_content += event.delta.text
                    result = on_chunk(LLMStreamChunk(content=event.delta.text, done=False))
                    if result is not None:
                        await result
                if event.type == "message_delta":
                    finish_reason = event.delta.stop_reason or "end_turn"
                if event.type == "message_start":
                    input_tokens = event.message.usage.input_tokens

            final_message = await stream.get_final_message()
            output_tokens = final_message.usage.output_tokens

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
        raise RuntimeError("Anthropic does not support embeddings. Use OpenAI for embedding generation.")

    def calculate_cost(self, input_tokens: int, output_tokens: int, model: str) -> float:
        costs = MODEL_COSTS.get(model, {"input": 0.0, "output": 0.0})
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
            logger.warn("anthropic_health_check_failed", err=str(exc), model=model)
            return ProviderHealthResult(
                provider=self.name,
                model=model,
                status="unavailable",
                latency_ms=int((time.time() - start) * 1000),
                error_message=str(exc),
            )
