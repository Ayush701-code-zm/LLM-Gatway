/**
 * Integration tests for session management routes.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Application } from 'express';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const WS_ID = '00000000-0000-4000-8000-000000000101';
const SESSION_A = '00000000-0000-4000-8000-000000000201';
const SESSION_B = '00000000-0000-4000-8000-000000000202';
const REFRESH_A = 'refresh-token-a';
const REFRESH_B = 'refresh-token-b';

const redisMock = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  ping: vi.fn().mockResolvedValue('PONG'),
  pipeline: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([]) }),
};

const prismaMock = {
  refreshToken: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
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

describe('Session routes', () => {
  beforeAll(async () => { await getApp(); });
  beforeEach(() => {
    prismaMock.refreshToken.findMany.mockReset();
    prismaMock.refreshToken.findFirst.mockReset();
    prismaMock.refreshToken.update.mockReset();
    prismaMock.refreshToken.updateMany.mockReset();
  });

  it('GET /auth/sessions lists active sessions', async () => {
    prismaMock.refreshToken.findMany.mockResolvedValueOnce([
      {
        id: SESSION_A,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
        userAgent: 'Playwright',
        ipAddress: '127.0.0.1',
      },
    ]);

    const res = await request(app)
      .get('/api/v1/auth/sessions')
      .set(bearer(USER_ID))
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].userAgent).toBe('Playwright');
  });

  it('DELETE /auth/sessions/:id revokes a session', async () => {
    prismaMock.refreshToken.findFirst.mockResolvedValueOnce({ id: SESSION_B });
    prismaMock.refreshToken.update.mockResolvedValueOnce({});

    await request(app)
      .delete(`/api/v1/auth/sessions/${SESSION_B}`)
      .set(bearer(USER_ID))
      .expect(204);

    expect(prismaMock.refreshToken.update).toHaveBeenCalled();
  });

  it('POST /auth/sessions/revoke-others revokes other refresh tokens', async () => {
    prismaMock.refreshToken.updateMany.mockResolvedValueOnce({ count: 2 });

    const res = await request(app)
      .post('/api/v1/auth/sessions/revoke-others')
      .set(bearer(USER_ID))
      .send({ refreshToken: REFRESH_A })
      .expect(200);

    expect(res.body.data.revokedCount).toBe(2);
    expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: USER_ID,
          token: { not: REFRESH_A },
        }),
      }),
    );
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app)
      .get('/api/v1/auth/sessions')
      .expect(401);

    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});
