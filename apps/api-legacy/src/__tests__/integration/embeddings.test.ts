/**
 * Integration tests for POST /embeddings (API key + provider routing).
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';

const WS_ID = '00000000-0000-4000-8000-000000000101';
const RAW_KEY = 'sr_embeddings_test_key_xyz789';

const generateEmbeddingMock = vi.fn().mockResolvedValue([0.11, 0.22, 0.33]);

vi.mock('../../providers/registry', () => ({
  providerRegistry: {
    get: vi.fn().mockReturnValue({
      generateEmbedding: (...args: unknown[]) => generateEmbeddingMock(...args),
    }),
  },
}));

vi.mock('../../engines/rateLimiter', () => ({
  rateLimiterEngine: {
    check: vi.fn().mockResolvedValue({
      limitRpm: 60,
      limitRpd: 1000,
      usedRpm: 1,
      usedRpd: 1,
      remainingRpm: 59,
      remainingRpd: 999,
      resetRpm: 0,
      resetRpd: 0,
    }),
  },
}));

const redisMock = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  ping: vi.fn().mockResolvedValue('PONG'),
  pipeline: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([]) }),
};

const prismaMock = {
  apiKey: {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
  modelRegistry: {
    findFirst: vi.fn(),
  },
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

function mockActiveKey(scopes: string[] = ['embeddings:write']) {
  prismaMock.apiKey.findUnique.mockResolvedValueOnce({
    id: 'key-emb-1',
    workspaceId: WS_ID,
    status: 'ACTIVE',
    expiresAt: null,
    scopes,
    rateLimitRpm: null,
    rateLimitTpm: null,
  });
}

function mockEmbeddingModel() {
  prismaMock.modelRegistry.findFirst.mockResolvedValueOnce({
    modelId: 'text-embedding-3-small',
    provider: 'OPENAI',
    supportsEmbeddings: true,
    isEnabled: true,
    inputCostPerMillion: 0.02,
  });
}

describe('POST /embeddings', () => {
  beforeAll(async () => { await getApp(); });
  beforeEach(() => {
    generateEmbeddingMock.mockClear();
    generateEmbeddingMock.mockResolvedValue([0.11, 0.22, 0.33]);
    prismaMock.apiKey.findUnique.mockReset();
    prismaMock.modelRegistry.findFirst.mockReset();
  });

  it('returns 401 when API key is missing', async () => {
    const res = await request(app)
      .post('/api/v1/embeddings')
      .send({ input: 'hello' })
      .expect(401);

    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(generateEmbeddingMock).not.toHaveBeenCalled();
  });

  it('returns 403 when API key lacks embedding scopes', async () => {
    mockActiveKey(['models:read']);

    const res = await request(app)
      .post('/api/v1/embeddings')
      .set('X-API-Key', RAW_KEY)
      .send({ input: 'hello' })
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 400 when embedding model is not enabled', async () => {
    mockActiveKey(['embeddings:write']);
    prismaMock.modelRegistry.findFirst.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/v1/embeddings')
      .set('X-API-Key', RAW_KEY)
      .send({ input: 'hello', model: 'missing-model' })
      .expect(400);

    expect(res.body.error.message).toMatch(/not found or not enabled/i);
  });

  it('returns embeddings for a valid API key', async () => {
    mockActiveKey(['embeddings:write']);
    mockEmbeddingModel();

    const res = await request(app)
      .post('/api/v1/embeddings')
      .set('X-API-Key', RAW_KEY)
      .send({ input: 'vector me', model: 'text-embedding-3-small' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.dimensions).toBe(3);
    expect(res.body.data.embeddings).toEqual([0.11, 0.22, 0.33]);
    expect(generateEmbeddingMock).toHaveBeenCalledWith('vector me', 'text-embedding-3-small');
  });

  it('accepts chat:write scope for embeddings', async () => {
    mockActiveKey(['chat:write']);
    mockEmbeddingModel();

    await request(app)
      .post('/api/v1/embeddings')
      .set('X-API-Key', RAW_KEY)
      .send({ input: 'via chat scope', model: 'text-embedding-3-small' })
      .expect(200);
  });
});
