import OpenAI from 'openai';
import type { LLMProvider } from './interface';
import type { LLMRequest, LLMResponse, LLMStreamChunk, ProviderHealthResult } from '../types';
import { env } from '../config/env';
import { logger } from '../config/logger';

// Cost per 1M tokens in USD — updated from model registry at runtime
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
  'text-embedding-3-large': { input: 0.13, output: 0 },
};

export class OpenAIProvider implements LLMProvider {
  readonly name = 'OPENAI';
  private readonly client: OpenAI | null;

  constructor() {
    this.client = env.OPENAI_API_KEY
      ? new OpenAI({ apiKey: env.OPENAI_API_KEY })
      : null;
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  private assertConfigured(): OpenAI {
    if (!this.client) throw new Error('OpenAI API key not configured');
    return this.client;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const client = this.assertConfigured();
    const start = Date.now();

    const completion = await client.chat.completions.create({
      model: request.model,
      messages: request.messages,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      stream: false,
    });

    const latencyMs = Date.now() - start;
    const choice = completion.choices[0];
    const usage = completion.usage!;

    return {
      content: choice.message.content ?? '',
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      finishReason: choice.finish_reason ?? 'stop',
      latencyMs,
      model: completion.model,
      provider: this.name,
      rawResponse: completion,
    };
  }

  async stream(
    request: LLMRequest,
    onChunk: (chunk: LLMStreamChunk) => void,
  ): Promise<LLMResponse> {
    const client = this.assertConfigured();
    const start = Date.now();

    const stream = await client.chat.completions.create({
      model: request.model,
      messages: request.messages,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      stream: true,
      stream_options: { include_usage: true },
    });

    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason = 'stop';

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) {
        fullContent += delta;
        onChunk({ content: delta, done: false });
      }
      if (chunk.choices[0]?.finish_reason) {
        finishReason = chunk.choices[0].finish_reason;
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens;
        outputTokens = chunk.usage.completion_tokens;
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

  async generateEmbedding(text: string, model: string): Promise<number[]> {
    const client = this.assertConfigured();
    const response = await client.embeddings.create({ model, input: text });
    return response.data[0].embedding;
  }

  calculateCost(inputTokens: number, outputTokens: number, model: string): number {
    const costs = MODEL_COSTS[model] ?? { input: 0, output: 0 };
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
      return {
        provider: this.name,
        model,
        status: 'available',
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      logger.warn({ err, provider: this.name, model }, 'Health check failed');
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
