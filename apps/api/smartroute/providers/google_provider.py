"""Google Gemini provider adapter."""

from __future__ import annotations

import time

import google.generativeai as genai

from smartroute.config import settings
from smartroute.config.logger import logger
from smartroute.providers.interface import LLMProvider
from smartroute.types.gateway import LLMMessage, LLMRequest, LLMResponse, LLMStreamChunk, ProviderHealthResult

MODEL_COSTS: dict[str, dict[str, float]] = {
    "gemini-2.0-flash": {"input": 0.1, "output": 0.4},
    "gemini-2.0-flash-lite": {"input": 0.075, "output": 0.3},
    "gemini-2.5-flash": {"input": 0.15, "output": 0.6},
}


class GoogleProvider(LLMProvider):
    name = "GOOGLE"

    def __init__(self) -> None:
        self._configured = bool(settings.GOOGLE_GENERATIVE_AI_API_KEY)
        if self._configured:
            genai.configure(api_key=settings.GOOGLE_GENERATIVE_AI_API_KEY)

    @property
    def is_configured(self) -> bool:
        return self._configured

    def _assert_configured(self) -> None:
        if not self._configured:
            raise RuntimeError("Google AI API key not configured")

    def _build_model(self, request: LLMRequest):
        self._assert_configured()
        system_instruction = next((m.content for m in request.messages if m.role == "system"), None)
        generation_config: dict[str, object] = {}
        if request.max_tokens is not None:
            generation_config["max_output_tokens"] = request.max_tokens
        if request.temperature is not None:
            generation_config["temperature"] = request.temperature

        kwargs: dict[str, object] = {"model_name": request.model}
        if generation_config:
            kwargs["generation_config"] = generation_config
        if system_instruction:
            kwargs["system_instruction"] = system_instruction
        return genai.GenerativeModel(**kwargs)

    def _chat_messages(self, messages: list[LLMMessage]) -> tuple[list[dict[str, object]], str]:
        chat_messages = [m for m in messages if m.role != "system"]
        history = [
            {
                "role": "model" if m.role == "assistant" else "user",
                "parts": [m.content],
            }
            for m in chat_messages[:-1]
        ]
        last_message = chat_messages[-1].content if chat_messages else ""
        return history, last_message

    async def generate(self, request: LLMRequest) -> LLMResponse:
        start = time.time()
        model = self._build_model(request)
        history, last_message = self._chat_messages(request.messages)
        chat = model.start_chat(history=history)
        result = await chat.send_message_async(last_message)
        response = result.response

        return LLMResponse(
            content=response.text or "",
            input_tokens=(response.usage_metadata.prompt_token_count if response.usage_metadata else 0) or 0,
            output_tokens=(response.usage_metadata.candidates_token_count if response.usage_metadata else 0) or 0,
            finish_reason=(response.candidates[0].finish_reason if response.candidates else "STOP") or "STOP",
            latency_ms=int((time.time() - start) * 1000),
            model=request.model,
            provider=self.name,
            raw_response=response,
        )

    async def stream(self, request: LLMRequest, on_chunk) -> LLMResponse:
        start = time.time()
        model = self._build_model(request)
        history, last_message = self._chat_messages(request.messages)
        chat = model.start_chat(history=history)

        full_content = ""
        input_tokens = 0
        output_tokens = 0

        response = await chat.send_message_async(last_message, stream=True)
        final_response = None
        async for chunk in response:
            text = chunk.text or ""
            if text:
                full_content += text
                result = on_chunk(LLMStreamChunk(content=text, done=False))
                if result is not None:
                    await result
            final_response = chunk

        if final_response is not None and getattr(final_response, "usage_metadata", None):
            input_tokens = final_response.usage_metadata.prompt_token_count or 0
            output_tokens = final_response.usage_metadata.candidates_token_count or 0

        result = on_chunk(LLMStreamChunk(content="", done=True, finish_reason="STOP"))
        if result is not None:
            await result

        return LLMResponse(
            content=full_content,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            finish_reason="STOP",
            latency_ms=int((time.time() - start) * 1000),
            model=request.model,
            provider=self.name,
        )

    async def generate_embedding(self, text: str, model: str) -> list[float]:
        raise RuntimeError("Use OpenAI for embedding generation.")

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
            logger.warn("google_health_check_failed", err=str(exc), model=model)
            return ProviderHealthResult(
                provider=self.name,
                model=model,
                status="unavailable",
                latency_ms=int((time.time() - start) * 1000),
                error_message=str(exc),
            )
