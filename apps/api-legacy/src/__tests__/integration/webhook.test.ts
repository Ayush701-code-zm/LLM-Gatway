/**
 * Integration tests for outbound webhook management routes.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Application } from 'express';

const WS_ID = '00000000-0000-4000-8000-000000000101';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const WEBHOOK_ID = '00000000-0000-4000-8000-000000000301';

const WEBHOOK = {
  id: WEBHOOK_ID,
  name: 'Slack Alerts',
  url: 'https://example.com/hook',
  events: ['budget.warning'],
  status: 'ACTIVE',
  failureCount: 0,
  lastTriggeredAt: null,
  createdAt: new Date(),
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
  webhook: {
    findMany: vi.fn(),
    create: vi.fn(),
    findFirst: vi.fn(),
    delete: vi.fn(),
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
  enqueueWebhookDelivery: vi.fn(),
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

vi.mock('../../lib/crypto', () => ({
  encryptSecret: (value: string) => `enc:${value}`,
  resolveSecret: (value: string) => value.replace(/^enc:/, ''),
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

describe('Webhook management routes', () => {
  beforeAll(async () => { await getApp(); });
  beforeEach(() => {
    prismaMock.workspaceMember.findFirst.mockReset();
    prismaMock.webhook.findMany.mockReset();
    prismaMock.webhook.create.mockReset();
    prismaMock.webhook.findFirst.mockReset();
    prismaMock.webhook.delete.mockReset();
  });

  it('GET /webhooks lists workspace webhooks', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue({ role: 'ADMIN' });
    prismaMock.webhook.findMany.mockResolvedValueOnce([WEBHOOK]);

    const res = await request(app)
      .get('/api/v1/webhooks')
      .set(bearer(USER_ID))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Slack Alerts');
  });

  it('POST /webhooks creates webhook for admins', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue({ role: 'ADMIN' });
    prismaMock.webhook.create.mockResolvedValueOnce({
      id: WEBHOOK_ID,
      name: 'PagerDuty',
      url: 'http://localhost:9999/hook',
      events: ['budget.critical'],
      status: 'ACTIVE',
      createdAt: new Date(),
    });

    const res = await request(app)
      .post('/api/v1/webhooks')
      .set(bearer(USER_ID))
      .send({
        name: 'PagerDuty',
        url: 'http://localhost:9999/hook',
        events: ['budget.critical'],
      })
      .expect(201);

    expect(res.body.data.name).toBe('PagerDuty');
    expect(res.body.data.signingSecret).toMatch(/^whs_/);
  });

  it('POST /webhooks returns 403 for non-admin members', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue({ role: 'MEMBER' });

    const res = await request(app)
      .post('/api/v1/webhooks')
      .set(bearer(USER_ID))
      .send({
        name: 'Blocked',
        url: 'http://localhost:9999/hook',
        events: ['budget.warning'],
      })
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('DELETE /webhooks/:id removes webhook', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue({ role: 'ADMIN' });
    prismaMock.webhook.findFirst.mockResolvedValueOnce(WEBHOOK);
    prismaMock.webhook.delete.mockResolvedValueOnce({});

    await request(app)
      .delete(`/api/v1/webhooks/${WEBHOOK_ID}`)
      .set(bearer(USER_ID))
      .expect(204);

    expect(prismaMock.webhook.delete).toHaveBeenCalledWith({ where: { id: WEBHOOK_ID } });
  });
});
