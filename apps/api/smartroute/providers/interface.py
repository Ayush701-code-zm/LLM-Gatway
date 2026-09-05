"""LLM provider interface."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable

from smartroute.types.gateway import LLMRequest, LLMResponse, LLMStreamChunk, ProviderHealthResult


class LLMProvider(ABC):
    name: str

    @property
    @abstractmethod
    def is_configured(self) -> bool: ...

    @abstractmethod
    async def generate(self, request: LLMRequest) -> LLMResponse: ...

    @abstractmethod
    async def stream(
        self,
        request: LLMRequest,
        on_chunk: Callable[[LLMStreamChunk], Awaitable[None] | None],
    ) -> LLMResponse: ...

    @abstractmethod
    async def generate_embedding(self, text: str, model: str) -> list[float]: ...

    @abstractmethod
    def calculate_cost(self, input_tokens: int, output_tokens: int, model: str) -> float: ...

    @abstractmethod
    async def health_check(self, model: str) -> ProviderHealthResult: ...
