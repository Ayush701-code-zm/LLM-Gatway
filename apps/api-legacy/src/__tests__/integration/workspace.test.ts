/**
 * Integration tests for workspace PATCH (slug update).
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Application } from 'express';

const WS_ID = 'ws-001';
const ADMIN_ID = 'admin-001';

const redisMock = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  setex: vi.fn().mockResolvedValue('OK'),
  del: vi.fn().mockResolvedValue(1),
  ping: vi.fn().mockResolvedValue('PONG'),
  pipeline: vi.fn().mockReturnValue({
    incr: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([[null, 1], [null, true]]),
  }),
};

const WORKSPACE = {
  id: WS_ID,
  slug: 'old-slug',
  name: 'Test Workspace',
  plan: 'FREE',
  defaultRoutingStrategy: 'COST_OPTIMIZED',
  semanticCacheEnabled: true,
  cacheThreshold: 0.92,
  allowedProviders: [],
  requestsPerMinute: null,
  requestsPerDay: null,
  tokensPerMinute: null,
};

const prismaMock = {
  user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn() },
  workspace: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
  },
  workspaceMember: { findFirst: vi.fn() },
  workspaceMembership: { findMany: vi.fn() },
  rateLimit: { upsert: vi.fn().mockResolvedValue({}) },
  refreshToken: { create: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
  notification: { create: vi.fn().mockResolvedValue({}) },
  budget: { create: vi.fn() },
  providerHealth: { findMany: vi.fn() },
  $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
  $transaction: vi.fn(),
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

vi.mock('../../lib/syncRateLimit', () => ({
  syncRateLimitRecord: vi.fn().mockResolvedValue(undefined),
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

describe('PATCH /api/v1/workspaces/current', () => {
  beforeAll(async () => { await getApp(); });
  beforeEach(() => {
    prismaMock.workspaceMember.findFirst.mockReset();
    prismaMock.workspace.findFirst.mockReset();
    prismaMock.workspace.findUniqueOrThrow.mockReset();
    prismaMock.workspace.update.mockReset();
    prismaMock.auditLog.create.mockClear();
    prismaMock.notification.create.mockClear();
  });

  it('updates workspace slug for admins', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue({ role: 'ADMIN' });
    prismaMock.workspace.findUniqueOrThrow.mockResolvedValue({ slug: 'old-slug', name: 'Test Workspace' });
    prismaMock.workspace.findFirst.mockResolvedValue(null);
    prismaMock.workspace.update.mockResolvedValue({ ...WORKSPACE, slug: 'new-slug' });

    const res = await request(app)
      .patch('/api/v1/workspaces/current')
      .set(bearer(ADMIN_ID))
      .send({ slug: 'new-slug' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.slug).toBe('new-slug');
    expect(prismaMock.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'WORKSPACE_SLUG_CHANGED',
          metadata: { previousSlug: 'old-slug', newSlug: 'new-slug' },
        }),
      }),
    );
  });

  it('returns 409 when slug is taken by another workspace', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue({ role: 'OWNER' });
    prismaMock.workspace.findUniqueOrThrow.mockResolvedValue({ slug: 'old-slug', name: 'Test Workspace' });
    prismaMock.workspace.findFirst.mockResolvedValue({ id: 'other-ws' });

    const res = await request(app)
      .patch('/api/v1/workspaces/current')
      .set(bearer(ADMIN_ID))
      .send({ slug: 'taken-slug' })
      .expect(409);

    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('returns 400 for invalid slug format', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue({ role: 'ADMIN' });

    const res = await request(app)
      .patch('/api/v1/workspaces/current')
      .set(bearer(ADMIN_ID))
      .send({ slug: 'Bad Slug!' })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for reserved slug', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue({ role: 'ADMIN' });

    const res = await request(app)
      .patch('/api/v1/workspaces/current')
      .set(bearer(ADMIN_ID))
      .send({ slug: 'api' })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('GET /workspaces/current/health returns provider health checks', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue({ role: 'MEMBER' });
    prismaMock.providerHealth.findMany.mockResolvedValueOnce([
      {
        status: 'AVAILABLE',
        latencyMs: 120,
        checkedAt: new Date(),
        model: { provider: 'OPENAI', modelId: 'gpt-4o' },
      },
    ]);

    const res = await request(app)
      .get('/api/v1/workspaces/current/health')
      .set(bearer(ADMIN_ID))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].model.provider).toBe('OPENAI');
  });
});
