/**
 * Integration tests for OAuth callback E2E bypass.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const WS_ID = '00000000-0000-4000-8000-000000000101';

const redisMock = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  ping: vi.fn().mockResolvedValue('PONG'),
  pipeline: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([]) }),
};

const prismaMock = {
  user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn() },
  workspace: { create: vi.fn(), findUnique: vi.fn() },
  workspaceMember: { findFirst: vi.fn(), create: vi.fn() },
  refreshToken: { create: vi.fn().mockResolvedValue({}) },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
  budget: { create: vi.fn().mockResolvedValue({}) },
  rateLimit: { upsert: vi.fn().mockResolvedValue({}) },
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

vi.mock('bcryptjs', () => ({
  default: { hash: vi.fn().mockResolvedValue('$2a$12$mock'), compare: vi.fn() },
  hash: vi.fn().mockResolvedValue('$2a$12$mock'),
  compare: vi.fn(),
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

describe('OAuth E2E bypass callback', () => {
  beforeAll(async () => { await getApp(); });
  beforeEach(() => {
    process.env.OAUTH_E2E_BYPASS = 'true';
    prismaMock.user.findUnique.mockReset();
    prismaMock.user.update.mockReset();
    prismaMock.workspaceMember.findFirst.mockReset();
    prismaMock.user.findUniqueOrThrow.mockReset();
    prismaMock.auditLog.create.mockClear();
    prismaMock.refreshToken.create.mockClear();
  });

  it('redirects to web callback after e2e-test-oauth code', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: USER_ID,
      email: 'oauth-e2e@example.com',
    });
    prismaMock.user.update.mockResolvedValue({});
    prismaMock.workspaceMember.findFirst.mockResolvedValueOnce({ workspaceId: WS_ID });
    prismaMock.user.findUniqueOrThrow
      .mockResolvedValueOnce({ id: USER_ID, email: 'oauth-e2e@example.com', mfaEnabled: false })
      .mockResolvedValueOnce({ role: 'USER' })
      .mockResolvedValueOnce({
        id: USER_ID,
        email: 'oauth-e2e@example.com',
        name: 'OAuth E2E',
        avatarUrl: null,
        role: 'USER',
        emailVerified: true,
        mfaEnabled: false,
        workspaceMemberships: [{
          role: 'OWNER',
          workspace: { id: WS_ID, slug: 'oauth-ws', name: 'OAuth WS' },
        }],
      });

    const res = await request(app)
      .get('/api/v1/auth/oauth/google/callback')
      .query({ code: 'e2e-test-oauth:oauth-e2e@example.com|OAuth E2E User' })
      .expect(302);

    expect(res.headers.location).toContain('/oauth/callback');
    expect(res.headers.location).toContain('accessToken=');
  });
});
