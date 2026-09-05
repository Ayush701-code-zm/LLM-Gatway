/**
 * Integration tests for POST /chat/stream (SSE).
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';

const WS_ID = '00000000-0000-4000-8000-000000000101';
const RAW_KEY = 'sr_stream_test_key_xyz';

const processChatStreamMock = vi.fn();

vi.mock('../../services/gateway.service', () => ({
  gatewayService: {
    processChatStream: (...args: unknown[]) => processChatStreamMock(...args),
  },
}));

const redisMock = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  ping: vi.fn().mockResolvedValue('PONG'),
  incr: vi.fn().mockResolvedValue(1),
  decr: vi.fn().mockResolvedValue(0),
  expire: vi.fn().mockResolvedValue(1),
  pipeline: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([]) }),
};

const prismaMock = {
  apiKey: {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
  $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
};

vi.mock('@smartroute/database', () => ({ prisma: prismaMock }));

vi.mock('../../config/redis', () => ({
  getRedis: () => redisMock,
  getBullMQConnectionOptions: () => ({ host: 'localhost', port: 6379 }),
}));

vi.mock('../../queues/index', () => ({
  startWorkers: vi.fn(),
  scheduleRecurringJobs: vi.fn(),
  getQueues: vi.fn().mockReturnValue({}),
  enqueueAnalyticsEvent: vi.fn(),
  triggerDailyAggregation: vi.fn(),
}));

vi.mock('../../config/metrics', () => ({
  register: { contentType: 'text/plain', metrics: vi.fn().mockResolvedValue('') },
  httpRequestDuration: { startTimer: vi.fn().mockReturnValue(vi.fn()) },
  llmRequestDuration: { observe: vi.fn() },
  llmRequestsTotal: { inc: vi.fn() },
  llmCostUsd: { inc: vi.fn() },
  llmSavingsUsd: { inc: vi.fn() },
  cacheHitsTotal: { inc: vi.fn() },
  cacheMissesTotal: { inc: vi.fn() },
  cacheHitRate: { set: vi.fn() },
  rateLimitedRequestsTotal: { inc: vi.fn() },
  fallbackEventsTotal: { inc: vi.fn() },
  circuitBreakerState: { set: vi.fn() },
  providerAvailability: { set: vi.fn() },
  queueDepth: { set: vi.fn() },
  activeConnections: { set: vi.fn() },
  collectDefaultMetrics: vi.fn(),
}));

let app: Application;

async function getApp(): Promise<Application> {
  if (app) return app;
  const express = (await import('express')).default;
  const helmet = (await import('helmet')).default;
  const cors = (await import('cors')).default;
  const compression = (await import('compression')).default;
  const { requestContextMiddleware } = await import('../../middleware/requestContext');
  const { errorHandler, notFoundHandler } = await import('../../middleware/errorHandler');
  const { metricsMiddleware } = await import('../../middleware/metrics');
  const { registerRoutes } = await import('../../routes/index');

  const a = express();
  a.set('trust proxy', 1);
  a.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  a.use(cors({ origin: '*', credentials: true }));
  a.use(compression());
  a.use(express.json());
  a.use(requestContextMiddleware);
  a.use(metricsMiddleware);
  registerRoutes(a);
  a.use(notFoundHandler);
  a.use(errorHandler);
  app = a;
  return app;
}

function mockActiveKey() {
  prismaMock.apiKey.findUnique.mockResolvedValueOnce({
    id: 'key-stream-1',
    workspaceId: WS_ID,
    status: 'ACTIVE',
    expiresAt: null,
    scopes: ['chat:write'],
    rateLimitRpm: null,
    rateLimitTpm: null,
  });
}

describe('POST /chat/stream', () => {
  beforeAll(async () => { await getApp(); });
  beforeEach(() => {
    processChatStreamMock.mockReset();
    processChatStreamMock.mockImplementation(async (_body, _options, handlers) => {
      handlers.onRouting({
        provider: 'OPENAI',
        model: 'gpt-4o',
        complexityLevel: 'SIMPLE',
        strategy: 'COST_OPTIMIZED',
      });
      handlers.onDelta('Hello');
      return {
        requestId: 'req-stream-1',
        traceId: 'trace-stream-1',
        finishReason: 'stop',
        usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
        cost: { actualUsd: 0.001, baselineUsd: 0.002, savingsUsd: 0.001 },
        routing: {
          provider: 'OPENAI',
          model: 'gpt-4o',
          strategy: 'COST_OPTIMIZED',
          complexityLevel: 'SIMPLE',
          fallbackUsed: false,
          retryCount: 0,
        },
      };
    });
    prismaMock.apiKey.findUnique.mockReset();
    redisMock.incr.mockResolvedValue(1);
  });

  it('returns 401 when API key is missing', async () => {
    await request(app)
      .post('/api/v1/chat/stream')
      .send({ message: 'hello' })
      .expect(401);

    expect(processChatStreamMock).not.toHaveBeenCalled();
  });

  it('streams SSE events for a valid API key', async () => {
    mockActiveKey();

    const res = await request(app)
      .post('/api/v1/chat/stream')
      .set('X-API-Key', RAW_KEY)
      .send({ message: 'stream me' })
      .expect(200);

    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.text).toContain('"type":"routing"');
    expect(res.text).toContain('"type":"delta"');
    expect(res.text).toContain('"type":"done"');
    expect(processChatStreamMock).toHaveBeenCalled();
  });
});
