export interface SmartRouteClientOptions {
  baseUrl?: string;
  apiKey: string;
  /** Default Idempotency-Key for chat requests (can override per call). */
  idempotencyKey?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  message: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface ChatResponse {
  requestId: string;
  traceId: string;
  message: string;
  model: string;
  provider: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  cost: { actualUsd: number; baselineUsd: number; savingsUsd: number; savingsPercent: number };
}

export class SmartRouteClient {
  private baseUrl: string;
  private apiKey: string;
  private defaultIdempotencyKey?: string;

  constructor(options: SmartRouteClientOptions) {
    this.baseUrl = (options.baseUrl ?? 'http://localhost:3001').replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.defaultIdempotencyKey = options.idempotencyKey;
  }

  private async request<T>(
    path: string,
    init: RequestInit & { idempotencyKey?: string } = {},
  ): Promise<T> {
    const { idempotencyKey, ...fetchInit } = init;
    const key = idempotencyKey ?? this.defaultIdempotencyKey;

    const res = await fetch(`${this.baseUrl}/api/v1${path}`, {
      ...fetchInit,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
        ...(key ? { 'Idempotency-Key': key } : {}),
        ...(fetchInit.headers as Record<string, string> | undefined),
      },
    });

    const json = (await res.json().catch(() => ({ success: false }))) as {
      success?: boolean;
      data?: T;
      error?: { message?: string };
    };
    if (!json.success) {
      throw new Error(json.error?.message ?? `Request failed (${res.status})`);
    }
    return json.data as T;
  }

  chat(body: ChatRequest, options?: { idempotencyKey?: string }): Promise<ChatResponse> {
    return this.request<ChatResponse>('/chat', {
      method: 'POST',
      body: JSON.stringify(body),
      idempotencyKey: options?.idempotencyKey,
    });
  }

  async *chatStream(body: ChatRequest): AsyncGenerator<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/api/v1/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok || !res.body) {
      throw new Error(`Stream request failed (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          yield JSON.parse(line.slice(6)) as Record<string, unknown>;
        } catch {
          // skip malformed chunks
        }
      }
    }
  }

  embeddings(input: string | string[], model?: string): Promise<{ embeddings: number[][]; model: string }> {
    return this.request('/embeddings', {
      method: 'POST',
      body: JSON.stringify({ input, model }),
    });
  }

  health(): Promise<{ status: string; version?: string; checks?: Record<string, unknown> }> {
    return fetch(`${this.baseUrl}/health`)
      .then(async (res) => {
        const json = await res.json();
        return json as { status: string; version?: string; checks?: Record<string, unknown> };
      });
  }

  models(): Promise<Array<{ id: string; provider: string; displayName: string }>> {
    return this.request('/models');
  }
}
