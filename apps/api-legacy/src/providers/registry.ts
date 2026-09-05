import type { LLMProvider } from './interface';
import { OpenAIProvider } from './openai.provider';
import { AnthropicProvider } from './anthropic.provider';
import { GoogleProvider } from './google.provider';
import { OllamaProvider } from './ollama.provider';
import { CohereProvider } from './cohere.provider';
import { MistralProvider } from './mistral.provider';

/**
 * Singleton provider registry.
 * Add new providers here — no other file needs to change.
 */
class ProviderRegistry {
  private readonly providers = new Map<string, LLMProvider>();

  constructor() {
    this.register(new OpenAIProvider());
    this.register(new AnthropicProvider());
    this.register(new GoogleProvider());
    this.register(new OllamaProvider());
    this.register(new CohereProvider());
    this.register(new MistralProvider());
  }

  private register(provider: LLMProvider): void {
    this.providers.set(provider.name, provider);
  }

  get(name: string): LLMProvider {
    const provider = this.providers.get(name.toUpperCase());
    if (!provider) throw new Error(`Provider "${name}" not registered`);
    return provider;
  }

  getAll(): LLMProvider[] {
    return Array.from(this.providers.values());
  }

  getConfigured(): LLMProvider[] {
    return this.getAll().filter((p) => p.isConfigured);
  }
}

export const providerRegistry = new ProviderRegistry();
