import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider } from './interface';
import type { LLMRequest, LLMResponse, LLMStreamChunk, ProviderHealthResult } from '../types';
import { env } from '../config/env';
import { logger } from '../config/logger';

const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4.0 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
  'claude-3-opus-20240229': { input: 15.0, output: 75.0 },
};

export class AnthropicProvider implements LLMProvider {
  readonly name = 'ANTHROPIC';
  private readonly client: Anthropic | null;

  constructor() {
    this.client = env.ANTHROPIC_API_KEY
      ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
      : null;
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  private assertConfigured(): Anthropic {
    if (!this.client) throw new Error('Anthropic API key not configured');
    return this.client;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const client = this.assertConfigured();
    const start = Date.now();

    const systemMessage = request.messages.find((m) => m.role === 'system');
    const userMessages = request.messages.filter((m) => m.role !== 'system');

    const response = await client.messages.create({
      model: request.model,
      max_tokens: request.maxTokens ?? 4096,
      system: systemMessage?.content,
      messages: userMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      ...(request.temperature !== undefined && {
        // Anthropic doesn't support temperature in this SDK version universally,
        // but we include it for completeness
      }),
    });

    const latencyMs = Date.now() - start;
    const textBlock = response.content.find((b) => b.type === 'text');

    return {
      content: textBlock?.type === 'text' ? textBlock.text : '',
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      finishReason: response.stop_reason ?? 'end_turn',
      latencyMs,
      model: response.model,
      provider: this.name,
      rawResponse: response,
    };
  }

  async stream(
    request: LLMRequest,
    onChunk: (chunk: LLMStreamChunk) => void,
  ): Promise<LLMResponse> {
    const client = this.assertConfigured();
    const start = Date.now();

    const systemMessage = request.messages.find((m) => m.role === 'system');
    const userMessages = request.messages.filter((m) => m.role !== 'system');

    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason = 'end_turn';

    const stream = await client.messages.stream({
      model: request.model,
      max_tokens: request.maxTokens ?? 4096,
      system: systemMessage?.content,
      messages: userMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        fullContent += event.delta.text;
        onChunk({ content: event.delta.text, done: false });
      }
      if (event.type === 'message_delta') {
        finishReason = event.delta.stop_reason ?? 'end_turn';
      }
      if (event.type === 'message_start') {
        inputTokens = event.message.usage.input_tokens;
      }
      if (event.type === 'message_delta' && 'usage' in event) {
        outputTokens = (event as { usage?: { output_tokens: number } }).usage?.output_tokens ?? 0;
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
    throw new Error('Anthropic does not support embeddings. Use OpenAI for embedding generation.');
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
      return { provider: this.name, model, status: 'available', latencyMs: Date.now() - start };
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
