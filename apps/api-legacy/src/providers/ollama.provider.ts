import type { LLMProvider } from './interface';
import type { LLMRequest, LLMResponse, LLMStreamChunk, ProviderHealthResult } from '../types';
import { env } from '../config/env';
import { logger } from '../config/logger';

interface OllamaGenerateResponse {
  model: string;
  message: { role: string; content: string };
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
  total_duration?: number;
}

export class OllamaProvider implements LLMProvider {
  readonly name = 'OLLAMA';
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = env.OLLAMA_BASE_URL;
  }

  get isConfigured(): boolean {
    return Boolean(this.baseUrl);
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const start = Date.now();

    const body = {
      model: request.model,
      messages: request.messages,
      stream: false,
      options: {
        num_predict: request.maxTokens ?? 2048,
        temperature: request.temperature ?? 0.7,
      },
    };

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as OllamaGenerateResponse;

    return {
      content: data.message.content,
      inputTokens: data.prompt_eval_count ?? 0,
      outputTokens: data.eval_count ?? 0,
      finishReason: 'stop',
      latencyMs: Date.now() - start,
      model: data.model,
      provider: this.name,
      rawResponse: data,
    };
  }

  async stream(
    request: LLMRequest,
    onChunk: (chunk: LLMStreamChunk) => void,
  ): Promise<LLMResponse> {
    const start = Date.now();

    const body = {
      model: request.model,
      messages: request.messages,
      stream: true,
      options: { num_predict: request.maxTokens ?? 2048, temperature: request.temperature ?? 0.7 },
    };

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok || !res.body) {
      throw new Error(`Ollama stream error ${res.status}`);
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
        const data = JSON.parse(line) as OllamaGenerateResponse;
        if (data.message?.content) {
          fullContent += data.message.content;
          onChunk({ content: data.message.content, done: false });
        }
        if (data.done) {
          inputTokens = data.prompt_eval_count ?? 0;
          outputTokens = data.eval_count ?? 0;
          onChunk({ content: '', done: true, finishReason: 'stop' });
        }
      }
    }

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

  async generateEmbedding(_text: string, _model: string): Promise<number[]> {
    throw new Error('Use OpenAI for embedding generation.');
  }

  calculateCost(_inputTokens: number, _outputTokens: number, _model: string): number {
    return 0; // Local inference — zero cost
  }

  async healthCheck(model: string): Promise<ProviderHealthResult> {
    const start = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      return { provider: this.name, model, status: 'available', latencyMs: Date.now() - start };
    } catch (err) {
      logger.warn({ err, provider: this.name, model }, 'Ollama health check failed');
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
