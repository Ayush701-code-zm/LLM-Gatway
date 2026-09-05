import type { LLMProvider } from './interface';
import type { LLMRequest, LLMResponse, LLMStreamChunk, ProviderHealthResult } from '../types';
import { env } from '../config/env';
import { logger } from '../config/logger';

const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'mistral-large-latest':  { input: 2.0,  output: 6.0 },
  'mistral-small-latest':  { input: 0.2,  output: 0.6 },
  'open-mistral-nemo':     { input: 0.15, output: 0.15 },
  'codestral-latest':      { input: 0.2,  output: 0.6 },
};

interface MistralChatResponse {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
}

interface MistralStreamChunk {
  choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class MistralProvider implements LLMProvider {
  readonly name = 'MISTRAL';
  private readonly apiKey: string | undefined;
  private readonly baseUrl = 'https://api.mistral.ai/v1';

  constructor() {
    this.apiKey = env.MISTRAL_API_KEY;
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  private assertConfigured(): string {
    if (!this.apiKey) throw new Error('Mistral API key not configured');
    return this.apiKey;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const apiKey = this.assertConfigured();
    const start = Date.now();

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        max_tokens: request.maxTokens ?? 2048,
        temperature: request.temperature ?? 0.7,
        stream: false,
      }),
    });

    if (!res.ok) {
      throw new Error(`Mistral error ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as MistralChatResponse;
    const choice = data.choices?.[0];

    return {
      content: choice?.message?.content ?? '',
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      finishReason: choice?.finish_reason ?? 'stop',
      latencyMs: Date.now() - start,
      model: data.model ?? request.model,
      provider: this.name,
      rawResponse: data,
    };
  }

  async stream(
    request: LLMRequest,
    onChunk: (chunk: LLMStreamChunk) => void,
  ): Promise<LLMResponse> {
    const apiKey = this.assertConfigured();
    const start = Date.now();

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        max_tokens: request.maxTokens ?? 2048,
        temperature: request.temperature ?? 0.7,
        stream: true,
      }),
    });

    if (!res.ok || !res.body) {
      throw new Error(`Mistral stream error ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason = 'stop';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const lines = decoder.decode(value, { stream: true }).split('\n').filter(Boolean);
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;

        const chunk = JSON.parse(payload) as MistralStreamChunk;
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          fullContent += delta;
          onChunk({ content: delta, done: false });
        }
        if (chunk.choices?.[0]?.finish_reason) {
          finishReason = chunk.choices[0].finish_reason ?? 'stop';
        }
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
          outputTokens = chunk.usage.completion_tokens ?? outputTokens;
        }
      }
    }

    onChunk({ content: '', done: true, finishReason });

    return {
      content: fullContent,
      inputTokens,
      outputTokens,
      finishReason,
      latencyMs: Date.now() - start,
      model: request.model,
      provider: this.name,
    };
  }

  async generateEmbedding(_text: string, _model: string): Promise<number[]> {
    throw new Error('Use OpenAI or Cohere for embedding generation.');
  }

  calculateCost(inputTokens: number, outputTokens: number, model: string): number {
    const costs = MODEL_COSTS[model] ?? { input: 0.5, output: 1.5 };
    return (inputTokens / 1_000_000) * costs.input + (outputTokens / 1_000_000) * costs.output;
  }

  async healthCheck(model: string): Promise<ProviderHealthResult> {
    const start = Date.now();
    try {
      await this.generate({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        maxTokens: 5,
      });
      return { provider: this.name, model, status: 'available', latencyMs: Date.now() - start };
    } catch (err) {
      logger.warn({ err, provider: this.name, model }, 'Mistral health check failed');
      return {
        provider: this.name,
        model,
        status: 'unavailable',
        latencyMs: Date.now() - start,
        errorMessage: (err as Error).message,
      };
    }
  }
}
