"""Provider registry singleton."""

from __future__ import annotations

from smartroute.providers.anthropic_provider import AnthropicProvider
from smartroute.providers.cohere_provider import CohereProvider
from smartroute.providers.google_provider import GoogleProvider
from smartroute.providers.interface import LLMProvider
from smartroute.providers.mistral_provider import MistralProvider
from smartroute.providers.ollama_provider import OllamaProvider
from smartroute.providers.openai_provider import OpenAIProvider


class ProviderRegistry:
    def __init__(self) -> None:
        self._providers: dict[str, LLMProvider] = {}
        for provider in (
            OpenAIProvider(),
            AnthropicProvider(),
            GoogleProvider(),
            OllamaProvider(),
            CohereProvider(),
            MistralProvider(),
        ):
            self._providers[provider.name] = provider

    def get(self, name: str) -> LLMProvider:
        provider = self._providers.get(name.upper())
        if not provider:
            raise RuntimeError(f'Provider "{name}" not registered')
        return provider

    def get_all(self) -> list[LLMProvider]:
        return list(self._providers.values())

    def get_configured(self) -> list[LLMProvider]:
        return [provider for provider in self._providers.values() if provider.is_configured]


provider_registry = ProviderRegistry()
