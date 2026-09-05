/**
 * Integration tests for API key management routes.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Application } from 'express';

const WS_ID = '00000000-0000-4000-8000-000000000101';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const KEY_ID = '00000000-0000-4000-8000-000000000501';

const API_KEY = {
  id: KEY_ID,
  name: 'Production',
  keyPrefix: 'sk-testprefix',
  status: 'ACTIVE',
  scopes: ['chat:write'],
  expiresAt: null,
  lastUsedAt: null,
  requestCount: '0',
  createdAt: new Date(),
  createdBy: { name: 'Admin', email: 'admin@example.com' },
  maskedKey: 'sk-test****',
};

const redisMock = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  ping: vi.fn().mockResolvedValue('PONG'),
  pipeline: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([]) }),
};

const prismaMock = {
  user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
  workspace: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
  workspaceMember: { findFirst: vi.fn() },
  apiKey: {
    findMany: vi.fn(),
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
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

vi.mock('../../lib/planEnforcement', () => ({
  enforceApiKeyLimit: vi.fn().mockResolvedValue(undefined),
  enforceMemberLimit: vi.fn().mockResolvedValue(undefined),
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

describe('API key routes', () => {
  beforeAll(async () => { await getApp(); });
  beforeEach(() => {
    prismaMock.workspaceMember.findFirst.mockReset();
    prismaMock.apiKey.findMany.mockReset();
    prismaMock.apiKey.create.mockReset();
    prismaMock.apiKey.findFirst.mockReset();
    prismaMock.apiKey.update.mockReset();
  });

  it('GET /api-keys lists workspace keys', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue({ role: 'MEMBER' });
    prismaMock.apiKey.findMany.mockResolvedValueOnce([API_KEY]);

    const res = await request(app)
      .get('/api/v1/api-keys')
      .set(bearer(USER_ID))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Production');
  });

  it('POST /api-keys creates a key and returns rawKey once', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue({ role: 'ADMIN' });
    prismaMock.apiKey.create.mockResolvedValueOnce({
      id: KEY_ID,
      name: 'CI Key',
      keyPrefix: 'sk-newprefix',
      status: 'ACTIVE',
      scopes: ['chat:write'],
      expiresAt: null,
      lastUsedAt: null,
      requestCount: BigInt(0),
      createdAt: new Date(),
    });

    const res = await request(app)
      .post('/api/v1/api-keys')
      .set(bearer(USER_ID))
      .send({ name: 'CI Key' })
      .expect(201);

    expect(res.body.data.rawKey).toMatch(/^sk-/);
    expect(res.body.meta.warning).toMatch(/rawKey/i);
  });

  it('DELETE /api-keys/:id revokes a key', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue({ role: 'ADMIN' });
    prismaMock.apiKey.findFirst.mockResolvedValueOnce({
      id: KEY_ID,
      workspaceId: WS_ID,
      status: 'ACTIVE',
    });
    prismaMock.apiKey.update.mockResolvedValueOnce({});

    const res = await request(app)
      .delete(`/api/v1/api-keys/${KEY_ID}`)
      .set(bearer(USER_ID))
      .expect(200);

    expect(res.body.data.message).toMatch(/revoked/i);
    expect(prismaMock.apiKey.update).toHaveBeenCalled();
  });

  it('POST /api-keys/:id/rotate issues a new raw key', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue({ role: 'ADMIN' });
    prismaMock.apiKey.findFirst.mockResolvedValueOnce({
      id: KEY_ID,
      workspaceId: WS_ID,
      status: 'ACTIVE',
      name: 'Production',
      scopes: ['chat:write'],
      expiresAt: null,
      rateLimitRpm: null,
      rateLimitTpm: null,
    });
    prismaMock.apiKey.update.mockResolvedValue({});
    prismaMock.apiKey.create.mockResolvedValueOnce({
      id: '00000000-0000-4000-8000-000000000502',
      name: 'Production (rotated)',
      keyPrefix: 'sk-rotated',
      status: 'ACTIVE',
      scopes: ['chat:write'],
      expiresAt: null,
      lastUsedAt: null,
      requestCount: BigInt(0),
      createdAt: new Date(),
    });

    const res = await request(app)
      .post(`/api/v1/api-keys/${KEY_ID}/rotate`)
      .set(bearer(USER_ID))
      .expect(201);

    expect(res.body.data.rawKey).toMatch(/^sk-/);
    expect(prismaMock.apiKey.update).toHaveBeenCalled();
  });

  it('POST /api-keys returns 403 for read-only viewers', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue({ role: 'VIEWER' });

    const res = await request(app)
      .post('/api/v1/api-keys')
      .set(bearer(USER_ID))
      .send({ name: 'Blocked' })
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app)
      .get('/api/v1/api-keys')
      .expect(401);

    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});
