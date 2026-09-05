/**
 * Integration tests for model registry routes.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Application } from 'express';

const WS_ID = '00000000-0000-4000-8000-000000000101';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const MODEL_ID = '00000000-0000-4000-8000-000000000401';

const MODEL = {
  id: MODEL_ID,
  provider: 'OPENAI',
  modelId: 'gpt-4o',
  displayName: 'GPT-4o',
  description: 'Flagship model',
  inputCostPerMillion: 2.5,
  outputCostPerMillion: 10,
  contextWindow: 128000,
  maxOutputTokens: 4096,
  supportsStreaming: true,
  supportsVision: true,
  supportsFunctions: true,
  supportsEmbeddings: false,
  qualityTier: 'PREMIUM',
  complexityMinLevel: 'MEDIUM',
  availabilityStatus: 'AVAILABLE',
  isEnabled: true,
  updatedAt: new Date(),
};

const redisMock = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  ping: vi.fn().mockResolvedValue('PONG'),
  pipeline: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([]) }),
};

const prismaMock = {
  user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
  workspace: { findUnique: vi.fn() },
  workspaceMember: { findFirst: vi.fn() },
  modelRegistry: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
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

function bearer(userId: string, workspaceId = WS_ID) {
  const token = jwt.sign(
    { sub: userId, workspaceId, email: 'admin@example.com', role: 'USER' },
    process.env.JWT_SECRET!,
    { expiresIn: '15m' },
  );
  return { Authorization: `Bearer ${token}` };
}

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

describe('Model registry routes', () => {
  beforeAll(async () => { await getApp(); });
  beforeEach(() => {
    prismaMock.workspaceMember.findFirst.mockReset();
    prismaMock.modelRegistry.findMany.mockReset();
    prismaMock.modelRegistry.findUnique.mockReset();
    prismaMock.modelRegistry.create.mockReset();
  });

  it('GET /models lists models without authentication', async () => {
    prismaMock.modelRegistry.findMany.mockResolvedValueOnce([MODEL]);

    const res = await request(app).get('/api/v1/models').expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].modelId).toBe('gpt-4o');
  });

  it('GET /models/:id returns a single model', async () => {
    prismaMock.modelRegistry.findUnique.mockResolvedValueOnce(MODEL);

    const res = await request(app).get(`/api/v1/models/${MODEL_ID}`).expect(200);

    expect(res.body.data.displayName).toBe('GPT-4o');
  });

  it('POST /models registers a model for workspace admins', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValueOnce({ role: 'ADMIN' });
    prismaMock.modelRegistry.findUnique.mockResolvedValueOnce(null);
    prismaMock.modelRegistry.create.mockResolvedValueOnce({
      ...MODEL,
      id: 'new-model-id',
      modelId: 'gpt-4o-mini',
      displayName: 'GPT-4o Mini',
    });

    const res = await request(app)
      .post('/api/v1/models')
      .set(bearer(USER_ID))
      .send({
        provider: 'OPENAI',
        modelId: 'gpt-4o-mini',
        displayName: 'GPT-4o Mini',
        inputCostPerMillion: 0.15,
        outputCostPerMillion: 0.6,
        contextWindow: 128000,
        maxOutputTokens: 4096,
        qualityTier: 'STANDARD',
        complexityMinLevel: 'SIMPLE',
      })
      .expect(201);

    expect(res.body.data.modelId).toBe('gpt-4o-mini');
  });

  it('POST /models returns 403 for non-admin members', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValueOnce({ role: 'MEMBER' });

    const res = await request(app)
      .post('/api/v1/models')
      .set(bearer(USER_ID))
      .send({
        provider: 'OPENAI',
        modelId: 'blocked-model',
        displayName: 'Blocked',
        inputCostPerMillion: 1,
        outputCostPerMillion: 2,
        contextWindow: 8192,
        maxOutputTokens: 1024,
        qualityTier: 'ECONOMY',
        complexityMinLevel: 'SIMPLE',
      })
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});
