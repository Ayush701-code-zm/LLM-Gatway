/**
 * Integration tests for notification routes.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Application } from 'express';

const WS_ID = '00000000-0000-4000-8000-000000000101';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const NOTIF_ID = '00000000-0000-4000-8000-000000000201';

const NOTIFICATION = {
  id: NOTIF_ID,
  workspaceId: WS_ID,
  userId: null,
  type: 'WORKSPACE_SLUG_CHANGED',
  title: 'Workspace slug updated',
  body: 'Slug changed',
  metadata: { previousSlug: 'old', newSlug: 'new' },
  readAt: null,
  createdAt: new Date('2025-06-25T12:00:00.000Z'),
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
  notification: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
    updateMany: vi.fn(),
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

function bearer(userId: string, workspaceId = WS_ID) {
  const token = jwt.sign(
    { sub: userId, workspaceId, email: 'user@example.com', role: 'USER' },
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

describe('Notification routes', () => {
  beforeAll(async () => { await getApp(); });
  beforeEach(() => {
    prismaMock.notification.findMany.mockReset();
    prismaMock.notification.findFirst.mockReset();
    prismaMock.notification.update.mockReset();
    prismaMock.notification.count.mockReset();
    prismaMock.notification.updateMany.mockReset();
    prismaMock.auditLog.create.mockClear();
  });

  it('GET /notifications returns paginated list', async () => {
    prismaMock.notification.findMany.mockResolvedValueOnce([NOTIFICATION]);
    prismaMock.notification.count.mockResolvedValueOnce(1);

    const res = await request(app)
      .get('/api/v1/notifications')
      .set(bearer(USER_ID))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.data).toHaveLength(1);
    expect(res.body.data.pagination.total).toBe(1);
  });

  it('GET /notifications/unread-count returns badge count', async () => {
    prismaMock.notification.count.mockResolvedValueOnce(3);

    const res = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set(bearer(USER_ID))
      .expect(200);

    expect(res.body.data.count).toBe(3);
  });

  it('PATCH /notifications/:id/read marks notification read', async () => {
    prismaMock.notification.findFirst.mockResolvedValueOnce(NOTIFICATION);
    prismaMock.notification.update.mockResolvedValueOnce({
      ...NOTIFICATION,
      readAt: new Date(),
    });

    const res = await request(app)
      .patch(`/api/v1/notifications/${NOTIF_ID}/read`)
      .set(bearer(USER_ID))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.readAt).toBeTruthy();
  });

  it('PATCH /notifications/:id/read returns 404 when not found', async () => {
    prismaMock.notification.findFirst.mockResolvedValueOnce(null);

    const res = await request(app)
      .patch(`/api/v1/notifications/${NOTIF_ID}/read`)
      .set(bearer(USER_ID))
      .expect(404);

    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('POST /notifications/read-all marks all unread in workspace', async () => {
    prismaMock.notification.updateMany.mockResolvedValueOnce({ count: 2 });

    const res = await request(app)
      .post('/api/v1/notifications/read-all')
      .set(bearer(USER_ID))
      .expect(200);

    expect(res.body.data.updated).toBe(2);
    expect(prismaMock.auditLog.create).toHaveBeenCalled();
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app)
      .get('/api/v1/notifications/unread-count')
      .expect(401);

    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});
