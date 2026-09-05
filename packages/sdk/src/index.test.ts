import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SmartRouteClient } from '../src/index';

describe('SmartRouteClient', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('sends X-API-Key header on chat requests', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          requestId: 'r1',
          traceId: 't1',
          message: 'hi',
          model: 'auto',
          provider: 'GOOGLE',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          cost: { actualUsd: 0, baselineUsd: 0, savingsUsd: 0, savingsPercent: 0 },
        },
      }),
    });

    const client = new SmartRouteClient({ apiKey: 'sr_test_key', baseUrl: 'http://localhost:3001' });
    await client.chat({ message: 'hello' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/api/v1/chat',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-API-Key': 'sr_test_key' }),
      }),
    );
  });

  it('throws on API error responses', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, error: { message: 'Invalid API key' } }),
    });

    const client = new SmartRouteClient({ apiKey: 'bad', baseUrl: 'http://localhost:3001' });
    await expect(client.chat({ message: 'x' })).rejects.toThrow('Invalid API key');
  });

  it('sends Idempotency-Key when configured', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          requestId: 'r1',
          traceId: 't1',
          message: 'hi',
          model: 'auto',
          provider: 'GOOGLE',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          cost: { actualUsd: 0, baselineUsd: 0, savingsUsd: 0, savingsPercent: 0 },
        },
      }),
    });

    const client = new SmartRouteClient({
      apiKey: 'sr_test_key',
      baseUrl: 'http://localhost:3001',
      idempotencyKey: 'idem-123',
    });
    await client.chat({ message: 'hello' });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ 'Idempotency-Key': 'idem-123' }),
      }),
    );
  });

  it('health() calls /health without API key', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok' }),
    });

    const client = new SmartRouteClient({ apiKey: 'sr_test', baseUrl: 'http://localhost:3001' });
    const health = await client.health();

    expect(health.status).toBe('ok');
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/health');
  });

  it('models() fetches available models', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: [{ id: 'gpt-4o', provider: 'OPENAI', displayName: 'GPT-4o' }],
      }),
    });

    const client = new SmartRouteClient({ apiKey: 'sr_test', baseUrl: 'http://localhost:3001' });
    const models = await client.models();

    expect(models).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/api/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-API-Key': 'sr_test' }),
      }),
    );
  });

  it('chatStream() yields SSE data events', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"delta","content":"Hi"}\n\n'));
        controller.close();
      },
    });

    fetchMock.mockResolvedValue({
      ok: true,
      body: stream,
    });

    const client = new SmartRouteClient({ apiKey: 'sr_test', baseUrl: 'http://localhost:3001' });
    const events: Record<string, unknown>[] = [];
    for await (const event of client.chatStream({ message: 'hello' })) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'delta', content: 'Hi' });
  });

  it('embeddings() posts input to the gateway', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          model: 'text-embedding-3-small',
          provider: 'OPENAI',
          embeddings: [0.1, 0.2],
          dimensions: 2,
          usage: { totalTokens: 4, latencyMs: 12 },
        },
      }),
    });

    const client = new SmartRouteClient({ apiKey: 'sr_test', baseUrl: 'http://localhost:3001' });
    const result = await client.embeddings('hello world');

    expect(result.dimensions).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/api/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-API-Key': 'sr_test' }),
      }),
    );
  });
});
