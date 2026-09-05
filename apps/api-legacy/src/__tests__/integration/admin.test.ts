/**
 * Integration tests for super-admin routes.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Application } from 'express';

const WS_ID = '00000000-0000-4000-8000-000000000101';
const SUPER_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000002';
const TARGET_WS = '00000000-0000-4000-8000-000000000201';

const redisMock = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  ping: vi.fn().mockResolvedValue('PONG'),
  pipeline: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([]) }),
};

const prismaMock = {
  user: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  workspace: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  request: { count: vi.fn() },
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

vi.mock('../../lib/syncRateLimit', () => ({
  syncRateLimitRecord: vi.fn().mockResolvedValue(undefined),
}));

let app: Application;

function bearer(userId: string, role: 'USER' | 'SUPER_ADMIN', workspaceId = WS_ID) {
  const token = jwt.sign(
    { sub: userId, workspaceId, email: 'admin@example.com', role },
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

describe('Admin routes', () => {
  beforeAll(async () => { await getApp(); });
  beforeEach(() => {
    prismaMock.user.count.mockReset();
    prismaMock.workspace.count.mockReset();
    prismaMock.request.count.mockReset();
    prismaMock.workspace.findMany.mockReset();
    prismaMock.workspace.findFirst.mockReset();
    prismaMock.workspace.update.mockReset();
  });

  it('returns 403 for non-super-admin users', async () => {
    const res = await request(app)
      .get('/api/v1/admin/overview')
      .set(bearer(USER_ID, 'USER'))
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('GET /admin/overview returns platform stats', async () => {
    prismaMock.user.count.mockResolvedValueOnce(12);
    prismaMock.workspace.count
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(4);
    prismaMock.request.count.mockResolvedValueOnce(42);

    const res = await request(app)
      .get('/api/v1/admin/overview')
      .set(bearer(SUPER_ID, 'SUPER_ADMIN'))
      .expect(200);

    expect(res.body.data).toEqual({
      users: 12,
      workspaces: 5,
      activeWorkspaces: 4,
      requestsToday: 42,
    });
  });

  it('PATCH /admin/workspaces/:id updates workspace plan', async () => {
    prismaMock.workspace.findFirst.mockResolvedValueOnce({
      id: TARGET_WS,
      plan: 'FREE',
    });
    prismaMock.workspace.update.mockResolvedValueOnce({
      id: TARGET_WS,
      plan: 'PRO',
    });

    const res = await request(app)
      .patch(`/api/v1/admin/workspaces/${TARGET_WS}`)
      .set(bearer(SUPER_ID, 'SUPER_ADMIN'))
      .send({ plan: 'PRO' })
      .expect(200);

    expect(res.body.data.plan).toBe('PRO');
  });

  it('GET /admin/workspaces returns paginated list', async () => {
    prismaMock.workspace.findMany.mockResolvedValueOnce([
      {
        id: TARGET_WS,
        name: 'Acme',
        slug: 'acme',
        plan: 'FREE',
        isActive: true,
        createdAt: new Date(),
        _count: { members: 2, requests: 10 },
      },
    ]);
    prismaMock.workspace.count.mockResolvedValueOnce(1);

    const res = await request(app)
      .get('/api/v1/admin/workspaces')
      .set(bearer(SUPER_ID, 'SUPER_ADMIN'))
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination.total).toBe(1);
  });
});
