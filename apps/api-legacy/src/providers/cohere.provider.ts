import type { LLMProvider } from './interface';
import type { LLMRequest, LLMResponse, LLMStreamChunk, ProviderHealthResult } from '../types';
import { env } from '../config/env';
import { logger } from '../config/logger';

const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'command-r-plus-08-2024': { input: 3.0,  output: 15.0 },
  'command-r-08-2024':      { input: 0.5,  output: 1.5 },
  'command-r7b-12-2024':    { input: 0.3,  output: 0.6 },
  'command-light':          { input: 0.3,  output: 0.6 },
  'embed-english-v3.0':     { input: 0.1, output: 0 },
};

interface CohereChatResponse {
  message?: { content?: Array<{ type: string; text?: string }> };
  usage?: { billed_units?: { input_tokens?: number; output_tokens?: number } };
}

export class CohereProvider implements LLMProvider {
  readonly name = 'COHERE';
  private readonly apiKey: string | undefined;
  private readonly baseUrl = 'https://api.cohere.com/v2';

  constructor() {
    this.apiKey = env.COHERE_API_KEY;
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  private assertConfigured(): string {
    if (!this.apiKey) throw new Error('Cohere API key not configured');
    return this.apiKey;
  }

  private buildMessages(request: LLMRequest): Array<{ role: string; content: string }> {
    return request.messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
      content: m.content,
    }));
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const apiKey = this.assertConfigured();
    const start = Date.now();

    const res = await fetch(`${this.baseUrl}/chat`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model,
        messages: this.buildMessages(request),
        max_tokens: request.maxTokens ?? 2048,
        temperature: request.temperature ?? 0.7,
      }),
    });

    if (!res.ok) {
      throw new Error(`Cohere error ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as CohereChatResponse;
    const content = data.message?.content?.map((c) => c.text ?? '').join('') ?? '';

    return {
      content,
      inputTokens:  data.usage?.billed_units?.input_tokens ?? 0,
      outputTokens: data.usage?.billed_units?.output_tokens ?? 0,
      finishReason: 'stop',
      latencyMs: Date.now() - start,
      model: request.model,
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

    const res = await fetch(`${this.baseUrl}/chat`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model,
        messages: this.buildMessages(request),
        max_tokens: request.maxTokens ?? 2048,
        temperature: request.temperature ?? 0.7,
        stream: true,
      }),
    });

    if (!res.ok || !res.body) {
      throw new Error(`Cohere stream error ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const lines = decoder.decode(value, { stream: true }).split('\n').filter(Boolean);
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;

        const event = JSON.parse(payload) as {
          type?: string;
          delta?: { message?: { content?: { text?: string } } };
          usage?: { billed_units?: { input_tokens?: number; output_tokens?: number } };
        };

        const delta = event.delta?.message?.content?.text;
        if (delta) {
          fullContent += delta;
          onChunk({ content: delta, done: false });
        }
        if (event.usage?.billed_units) {
          inputTokens = event.usage.billed_units.input_tokens ?? inputTokens;
          outputTokens = event.usage.billed_units.output_tokens ?? outputTokens;
        }
      }
    }

    onChunk({ content: '', done: true, finishReason: 'stop' });

    return {
      content: fullContent,
      inputTokens,
      outputTokens,
      finishReason: 'stop',
      latencyMs: Date.now() - start,
      model: request.model,
      provider: this.name,
    };
  }

  async generateEmbedding(text: string, model: string): Promise<number[]> {
    const apiKey = this.assertConfigured();
    const res = await fetch(`${this.baseUrl}/embed`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        texts: [text],
        input_type: 'search_document',
        embedding_types: ['float'],
      }),
    });

    if (!res.ok) {
      throw new Error(`Cohere embed error ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as { embeddings?: { float?: number[][] } };
    const embedding = data.embeddings?.float?.[0];
    if (!embedding) throw new Error('Cohere returned no embedding');
    return embedding;
  }

  calculateCost(inputTokens: number, outputTokens: number, model: string): number {
    const costs = MODEL_COSTS[model] ?? { input: 1.0, output: 3.0 };
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
      logger.warn({ err, provider: this.name, model }, 'Cohere health check failed');
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
