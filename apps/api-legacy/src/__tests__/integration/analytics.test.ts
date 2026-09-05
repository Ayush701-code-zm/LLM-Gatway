/**
 * Integration tests for analytics routes.
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

const prismaMock = {
  user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
  workspace: { findUnique: vi.fn() },
  workspaceMember: { findFirst: vi.fn() },
  request: {
    count: vi.fn(),
    aggregate: vi.fn(),
    groupBy: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
  spendingAnalytic: {
    findMany: vi.fn(),
  },
  fallbackEvent: {
    groupBy: vi.fn(),
    findMany: vi.fn(),
  },
  circuitBreakerEvent: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  notification: {
    findMany: vi.fn(),
  },
  usageMetric: {
    findMany: vi.fn(),
  },
  providerLog: {
    groupBy: vi.fn(),
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

describe('Analytics routes', () => {
  beforeAll(async () => { await getApp(); });
  beforeEach(() => {
    prismaMock.workspaceMember.findFirst.mockReset();
    prismaMock.request.count.mockReset();
    prismaMock.request.aggregate.mockReset();
    prismaMock.request.groupBy.mockReset();
    prismaMock.request.findMany.mockReset();
    prismaMock.request.findFirst.mockReset();
    prismaMock.fallbackEvent.groupBy.mockReset();
    prismaMock.fallbackEvent.findMany.mockReset();
    prismaMock.circuitBreakerEvent.count.mockReset();
    prismaMock.circuitBreakerEvent.findMany.mockReset();
    prismaMock.notification.findMany.mockReset();
    prismaMock.usageMetric.findMany.mockReset();
    prismaMock.providerLog.groupBy.mockReset();

    prismaMock.workspaceMember.findFirst.mockResolvedValue({ role: 'OWNER' });
    prismaMock.request.count.mockImplementation((args: { where?: Record<string, unknown> }) => {
      if (args.where && 'fallbackUsed' in args.where) return Promise.resolve(5);
      if (args.where && 'retryCount' in args.where) return Promise.resolve(3);
      if (args.where?.status === 'FAILED') return Promise.resolve(4);
      if (args.where && 'status' in args.where) return Promise.resolve(95);
      return Promise.resolve(100);
    });
    prismaMock.request.aggregate.mockImplementation((args: { _avg?: unknown; where?: Record<string, unknown> }) => {
      if (args._avg) return Promise.resolve({ _avg: { totalLatencyMs: 250 } });
      if (args.where?.cacheHit === true) return Promise.resolve({ _sum: { savingsUsd: 2 } });
      return Promise.resolve({ _sum: { actualCostUsd: 10, savingsUsd: 5 } });
    });
    prismaMock.request.groupBy.mockResolvedValue([
      { cacheHit: true, _count: 30 },
      { cacheHit: false, _count: 70 },
    ]);
    prismaMock.spendingAnalytic.findMany.mockReset();

    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-001',
        traceId: 'trace-001',
        status: 'COMPLETED',
        requestedModel: 'gpt-4o',
        cacheHit: false,
        complexityLevel: 'SIMPLE',
        inputTokens: 10,
        outputTokens: 5,
        actualCostUsd: 0.01,
        savingsUsd: 0.002,
        totalLatencyMs: 400,
        fallbackUsed: false,
        retryCount: 0,
        createdAt: new Date(),
        model: { provider: 'OPENAI', modelId: 'gpt-4o' },
      },
    ]);
    prismaMock.request.findFirst.mockResolvedValue({
      id: 'req-001',
      traceId: 'trace-001',
      status: 'COMPLETED',
      prompt: 'hello',
      systemPrompt: null,
      response: 'hi there',
      requestedModel: 'gpt-4o',
      cacheHit: false,
      complexityLevel: 'SIMPLE',
      inputTokens: 10,
      outputTokens: 5,
      actualCostUsd: 0.01,
      savingsUsd: 0.002,
      totalLatencyMs: 400,
      fallbackUsed: false,
      retryCount: 0,
      finishReason: 'stop',
      createdAt: new Date(),
      model: { provider: 'OPENAI', modelId: 'gpt-4o' },
    });
    prismaMock.spendingAnalytic.findMany.mockResolvedValue([
      { date: new Date('2025-06-01'), totalCostUsd: 1.5, totalSavingsUsd: 0.5 },
    ]);
    prismaMock.fallbackEvent.groupBy.mockResolvedValue([
      { failedProvider: 'OPENAI', fallbackProvider: 'ANTHROPIC', _count: { id: 3 } },
    ]);
    prismaMock.fallbackEvent.findMany.mockResolvedValue([]);
    prismaMock.circuitBreakerEvent.count.mockResolvedValue(2);
    prismaMock.circuitBreakerEvent.findMany.mockResolvedValue([]);
    prismaMock.notification.findMany.mockResolvedValue([
      {
        id: 'notif-001',
        type: 'ANOMALY_DETECTED',
        title: 'Spend spike',
        body: 'Daily spend exceeded threshold',
        metadata: { metric: 'cost' },
        readAt: null,
        createdAt: new Date('2025-06-01T08:00:00.000Z'),
      },
    ]);
    prismaMock.usageMetric.findMany.mockResolvedValue([
      { metricName: 'request_cost_usd', metricValue: 1.5, recordedAt: new Date('2025-06-01T12:00:00.000Z') },
      { metricName: 'request_count', metricValue: 10, recordedAt: new Date('2025-06-01T12:00:00.000Z') },
      { metricName: 'request_latency_ms', metricValue: 200, recordedAt: new Date('2025-06-01T12:00:00.000Z') },
    ]);
    prismaMock.providerLog.groupBy.mockResolvedValue([
      {
        modelRegistryId: 'model-001',
        _count: { id: 12 },
        _sum: { costUsd: 1.2, latencyMs: 4800 },
        _avg: { latencyMs: 400 },
      },
    ]);
  });

  it('GET /analytics/overview returns workspace stats', async () => {
    const res = await request(app)
      .get('/api/v1/analytics/overview')
      .set(bearer(USER_ID))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.totalRequests).toBe(100);
    expect(res.body.data.totalCostUsd).toBe(10);
    expect(res.body.data.period).toBe('30d');
  });

  it('GET /analytics/spend/daily returns time series', async () => {
    const res = await request(app)
      .get('/api/v1/analytics/spend/daily?days=30')
      .set(bearer(USER_ID))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(prismaMock.spendingAnalytic.findMany).toHaveBeenCalled();
  });

  it('GET /analytics/requests returns paginated request history', async () => {
    const res = await request(app)
      .get('/api/v1/analytics/requests?page=1&limit=20')
      .set(bearer(USER_ID))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination.total).toBe(100);
    expect(res.body.data[0].traceId).toBe('trace-001');
  });

  it('GET /analytics/requests/:id returns request detail', async () => {
    const res = await request(app)
      .get('/api/v1/analytics/requests/req-001')
      .set(bearer(USER_ID))
      .expect(200);

    expect(res.body.data.response).toBe('hi there');
    expect(prismaMock.request.findFirst).toHaveBeenCalled();
  });

  it('GET /analytics/reliability returns fallback and circuit stats', async () => {
    const res = await request(app)
      .get('/api/v1/analytics/reliability?days=30')
      .set(bearer(USER_ID))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.totalRequests).toBe(100);
    expect(res.body.data.fallbackCount).toBe(5);
    expect(res.body.data.fallbackRate).toBe('5.0');
    expect(res.body.data.circuitBreakerOpens).toBe(2);
    expect(res.body.data.fallbackByProvider).toHaveLength(1);
  });

  it('GET /analytics/anomalies returns anomaly notifications', async () => {
    const res = await request(app)
      .get('/api/v1/analytics/anomalies?days=30')
      .set(bearer(USER_ID))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.count).toBe(1);
    expect(res.body.data.anomalies[0].type).toBe('ANOMALY_DETECTED');
    expect(prismaMock.notification.findMany).toHaveBeenCalled();
  });

  it('GET /analytics/usage returns aggregated time series', async () => {
    const res = await request(app)
      .get('/api/v1/analytics/usage?days=30')
      .set(bearer(USER_ID))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.series).toHaveLength(1);
    expect(res.body.data.series[0].requests).toBe(10);
    expect(prismaMock.usageMetric.findMany).toHaveBeenCalled();
  });

  it('GET /analytics/providers returns provider usage stats', async () => {
    const res = await request(app)
      .get('/api/v1/analytics/providers')
      .set(bearer(USER_ID))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].modelRegistryId).toBe('model-001');
    expect(prismaMock.providerLog.groupBy).toHaveBeenCalled();
  });

  it('GET /analytics/export returns CSV attachment', async () => {
    const res = await request(app)
      .get('/api/v1/analytics/export?format=csv')
      .set(bearer(USER_ID))
      .expect(200);

    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('traceId,createdAt,requestedModel');
    expect(res.text).toContain('trace-001');
  });

  it('GET /analytics/export returns JSON rows', async () => {
    const res = await request(app)
      .get('/api/v1/analytics/export?format=json&limit=10')
      .set(bearer(USER_ID))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.count).toBe(1);
  });

  it('GET /analytics/export returns 400 for invalid date range', async () => {
    const res = await request(app)
      .get('/api/v1/analytics/export?from=not-a-date&to=also-bad')
      .set(bearer(USER_ID))
      .expect(400);

    expect(res.body.error.code).toBe('INVALID_DATE');
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app)
      .get('/api/v1/analytics/overview')
      .expect(401);

    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});
