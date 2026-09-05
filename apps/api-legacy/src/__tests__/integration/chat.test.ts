/**
 * Integration tests for POST /chat (API key auth + gateway routing).
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createHash } from 'crypto';
import type { Application } from 'express';

const WS_ID = '00000000-0000-4000-8000-000000000101';
const RAW_KEY = 'sr_integration_test_key_abc123';
const KEY_HASH = createHash('sha256').update(RAW_KEY).digest('hex');

const processChatMock = vi.fn();

vi.mock('../../services/gateway.service', () => ({
  gatewayService: {
    processChat: (...args: unknown[]) => processChatMock(...args),
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

const CHAT_RESPONSE = {
  requestId: 'req-chat-1',
  traceId: 'trace-chat-1',
  message: 'Hello from gateway',
  model: 'gpt-4o',
  provider: 'OPENAI',
  usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  cost: { actualUsd: 0.001, baselineUsd: 0.002, savingsUsd: 0.001, savingsPercent: 50 },
};

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

function mockActiveKey(scopes: string[] = ['chat:write']) {
  prismaMock.apiKey.findUnique.mockResolvedValueOnce({
    id: 'key-001',
    workspaceId: WS_ID,
    status: 'ACTIVE',
    expiresAt: null,
    scopes,
    rateLimitRpm: null,
    rateLimitTpm: null,
  });
}

describe('POST /chat', () => {
  beforeAll(async () => { await getApp(); });
  beforeEach(() => {
    processChatMock.mockReset();
    processChatMock.mockResolvedValue(CHAT_RESPONSE);
    prismaMock.apiKey.findUnique.mockReset();
    redisMock.incr.mockResolvedValue(1);
  });

  it('returns 401 when API key is missing', async () => {
    const res = await request(app)
      .post('/api/v1/chat')
      .send({ message: 'hello' })
      .expect(401);

    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(processChatMock).not.toHaveBeenCalled();
  });

  it('returns 403 when API key lacks chat:write scope', async () => {
    mockActiveKey(['embeddings:write']);

    const res = await request(app)
      .post('/api/v1/chat')
      .set('X-API-Key', RAW_KEY)
      .send({ message: 'hello' })
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(processChatMock).not.toHaveBeenCalled();
  });

  it('returns gateway response for a valid API key', async () => {
    mockActiveKey(['chat:write']);

    const res = await request(app)
      .post('/api/v1/chat')
      .set('X-API-Key', RAW_KEY)
      .send({ message: 'hello' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.message).toBe('Hello from gateway');
    expect(processChatMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'hello' }),
      expect.objectContaining({
        apiKey: expect.objectContaining({ workspaceId: WS_ID }),
      }),
    );
  });
});
