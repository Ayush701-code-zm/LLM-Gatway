/**
 * Integration tests for SCIM 2.0 API.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createHash, randomBytes } from 'node:crypto';
import type { Application } from 'express';

const WS_ID = '00000000-0000-4000-8000-000000000201';
const USER_ID = '00000000-0000-4000-8000-000000000301';

function makeScimToken() {
  const raw = `sr_scim_${randomBytes(24).toString('hex')}`;
  return { raw, hash: createHash('sha256').update(raw).digest('hex') };
}

const SCIM_TOKEN = makeScimToken();
const SCIM_EMAIL = 'scim-user@example.com';

const redisMock = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  ping: vi.fn().mockResolvedValue('PONG'),
  pipeline: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([]) }),
};

const prismaMock = {
  workspace: { findFirst: vi.fn() },
  user: { findUnique: vi.fn(), create: vi.fn() },
  workspaceMember: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
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
  enforceMemberLimit: vi.fn().mockResolvedValue(undefined),
}));

let app: Application;

function scimAuth(token = SCIM_TOKEN.raw) {
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

describe('SCIM API', () => {
  beforeAll(async () => { await getApp(); });
  beforeEach(() => {
    prismaMock.workspace.findFirst.mockReset();
    prismaMock.workspaceMember.findMany.mockReset();
    prismaMock.workspaceMember.findFirst.mockReset();
    prismaMock.workspaceMember.create.mockReset();
    prismaMock.user.findUnique.mockReset();
    prismaMock.user.create.mockReset();
    prismaMock.auditLog.create.mockClear();

    prismaMock.workspace.findFirst.mockImplementation(({ where }: {
      where: { scimTokenHash?: string };
    }) => {
      if (where.scimTokenHash === SCIM_TOKEN.hash) {
        return Promise.resolve({ id: WS_ID });
      }
      return Promise.resolve(null);
    });
  });

  it('returns 401 without SCIM bearer token', async () => {
    const res = await request(app).get('/scim/v2/Users').expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('GET /scim/v2/ServiceProviderConfig returns SCIM metadata', async () => {
    const res = await request(app)
      .get('/scim/v2/ServiceProviderConfig')
      .set(scimAuth())
      .expect(200);

    expect(res.body.schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig');
  });

  it('GET /scim/v2/Users lists workspace members', async () => {
    prismaMock.workspaceMember.findMany.mockResolvedValueOnce([
      {
        role: 'OWNER',
        user: { id: USER_ID, email: 'owner@example.com', name: 'Owner', deletedAt: null },
      },
    ]);

    const res = await request(app)
      .get('/scim/v2/Users')
      .set(scimAuth())
      .expect(200);

    expect(res.body.totalResults).toBe(1);
    expect(res.body.Resources[0].userName).toBe('owner@example.com');
  });

  it('POST /scim/v2/Users provisions a new member', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    prismaMock.user.create.mockResolvedValueOnce({
      id: USER_ID,
      email: SCIM_EMAIL,
      name: 'SCIM User',
      deletedAt: null,
    });
    prismaMock.workspaceMember.findFirst.mockResolvedValueOnce(null);
    prismaMock.workspaceMember.create.mockResolvedValueOnce({
      role: 'MEMBER',
      user: { id: USER_ID, email: SCIM_EMAIL, name: 'SCIM User', deletedAt: null },
    });

    const res = await request(app)
      .post('/scim/v2/Users')
      .set(scimAuth())
      .send({
        userName: SCIM_EMAIL,
        name: { formatted: 'SCIM User' },
        emails: [{ value: SCIM_EMAIL, primary: true }],
      })
      .expect(201);

    expect(res.body.userName).toBe(SCIM_EMAIL);
    expect(res.body.active).toBe(true);
    expect(prismaMock.auditLog.create).toHaveBeenCalled();
  });

  it('rejects invalid SCIM token hash', async () => {
    const badToken = `sr_scim_${'a'.repeat(48)}`;
    const res = await request(app)
      .get('/scim/v2/Users')
      .set({ Authorization: `Bearer ${badToken}` })
      .expect(401);

    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(createHash('sha256').update(badToken).digest('hex')).not.toBe(SCIM_TOKEN.hash);
  });
});
