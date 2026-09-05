/**
 * Integration tests for workspace audit log list + CSV export.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Application } from 'express';

const WS_ID = '00000000-0000-4000-8000-000000000101';
const USER_ID = '00000000-0000-4000-8000-000000000001';

const redisMock = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  ping: vi.fn().mockResolvedValue('PONG'),
  pipeline: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([]) }),
};

const AUDIT_ENTRY = {
  id: 'audit-001',
  workspaceId: WS_ID,
  action: 'WORKSPACE_UPDATED',
  resourceType: 'workspace',
  resourceId: WS_ID,
  ipAddress: '127.0.0.1',
  metadata: { previousSlug: 'old-co', newSlug: 'new-co' },
  createdAt: new Date('2025-06-01T12:00:00.000Z'),
  user: { id: USER_ID, name: 'Admin', email: 'admin@example.com' },
};

const prismaMock = {
  user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
  workspace: { findUnique: vi.fn() },
  workspaceMember: { findFirst: vi.fn() },
  auditLog: { findMany: vi.fn(), count: vi.fn() },
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

describe('Workspace audit log routes', () => {
  beforeAll(async () => { await getApp(); });
  beforeEach(() => {
    prismaMock.workspaceMember.findFirst.mockReset();
    prismaMock.auditLog.findMany.mockReset();
    prismaMock.auditLog.count.mockReset();

    prismaMock.workspaceMember.findFirst.mockResolvedValue({ role: 'OWNER' });
    prismaMock.auditLog.findMany.mockResolvedValue([AUDIT_ENTRY]);
    prismaMock.auditLog.count.mockResolvedValue(1);
  });

  it('GET /workspaces/current/audit-logs returns paginated entries', async () => {
    const res = await request(app)
      .get('/api/v1/workspaces/current/audit-logs?page=1&limit=30')
      .set(bearer(USER_ID))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.data).toHaveLength(1);
    expect(res.body.data.data[0].action).toBe('WORKSPACE_UPDATED');
    expect(res.body.data.pagination.total).toBe(1);
  });

  it('GET /workspaces/current/audit-logs/export returns CSV', async () => {
    const res = await request(app)
      .get('/api/v1/workspaces/current/audit-logs/export?format=csv')
      .set(bearer(USER_ID))
      .expect(200);

    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('id,action,resourceType');
    expect(res.text).toContain('WORKSPACE_UPDATED');
    expect(res.text).toContain('old-co');
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app)
      .get('/api/v1/workspaces/current/audit-logs')
      .expect(401);

    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});
