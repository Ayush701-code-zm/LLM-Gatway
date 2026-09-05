/**
 * Integration tests for billing routes.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Application } from 'express';

const WS_ID = '00000000-0000-4000-8000-000000000101';
const USER_ID = '00000000-0000-4000-8000-000000000001';

const checkoutCreateMock = vi.fn().mockResolvedValue({
  url: 'https://checkout.stripe.com/c/pay/cs_test_123',
  id: 'cs_test_123',
});
const portalCreateMock = vi.fn().mockResolvedValue({
  url: 'https://billing.stripe.com/p/session/test_portal',
});
const customerCreateMock = vi.fn().mockResolvedValue({ id: 'cus_test_123' });

vi.mock('stripe', () => ({
  default: class StripeMock {
    customers = { create: customerCreateMock };
    checkout = { sessions: { create: checkoutCreateMock } };
    billingPortal = { sessions: { create: portalCreateMock } };
  },
}));

const redisMock = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  ping: vi.fn().mockResolvedValue('PONG'),
  pipeline: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([]) }),
};

const prismaMock = {
  user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
  workspace: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
  workspaceMember: { findFirst: vi.fn() },
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
let stripeEnvEnabled = false;

vi.mock('../../config/env', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../config/env')>();
  return {
    env: new Proxy(mod.env, {
      get(target, prop, receiver) {
        if (prop === 'STRIPE_SECRET_KEY') {
          return stripeEnvEnabled ? 'sk_test_mock' : undefined;
        }
        if (prop === 'STRIPE_PRICE_PRO') {
          return stripeEnvEnabled ? 'price_pro_test' : undefined;
        }
        if (prop === 'STRIPE_PRICE_ENTERPRISE') {
          return stripeEnvEnabled ? 'price_ent_test' : undefined;
        }
        return Reflect.get(target, prop, receiver);
      },
    }),
  };
});

function bearer(userId: string, workspaceId = WS_ID) {
  const token = jwt.sign(
    { sub: userId, workspaceId, email: 'owner@example.com', role: 'USER' },
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

describe('Billing routes', () => {
  beforeAll(async () => { await getApp(); });
  beforeEach(() => {
    stripeEnvEnabled = false;
    prismaMock.workspaceMember.findFirst.mockReset();
    prismaMock.workspace.findUniqueOrThrow.mockReset();
    prismaMock.user.findUniqueOrThrow.mockReset();
    prismaMock.workspace.update.mockReset();
    checkoutCreateMock.mockClear();
    customerCreateMock.mockClear();
    portalCreateMock.mockClear();
  });

  it('GET /billing/plans returns tiers without auth', async () => {
    const res = await request(app).get('/api/v1/billing/plans').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.data.map((p: { id: string }) => p.id)).toEqual(['FREE', 'PRO', 'ENTERPRISE']);
  });

  it('GET /billing/status reports stripeConfigured=false when unset', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue({ role: 'OWNER' });
    prismaMock.workspace.findUniqueOrThrow.mockResolvedValue({
      plan: 'FREE',
      stripeCustomerId: null,
    });

    const res = await request(app)
      .get('/api/v1/billing/status')
      .set(bearer(USER_ID))
      .expect(200);

    expect(res.body.data.currentPlan).toBe('FREE');
    expect(res.body.data.stripeConfigured).toBe(false);
  });

  it('POST /billing/checkout returns 400 when Stripe is not configured', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue({ role: 'OWNER' });

    const res = await request(app)
      .post('/api/v1/billing/checkout')
      .set(bearer(USER_ID))
      .send({ plan: 'PRO' })
      .expect(400);

    expect(res.body.error.message).toMatch(/not configured/i);
  });

  it('POST /billing/checkout creates session for workspace owner', async () => {
    stripeEnvEnabled = true;
    prismaMock.workspaceMember.findFirst.mockResolvedValue({ role: 'OWNER' });
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({ email: 'owner@example.com' });
    prismaMock.workspace.findUniqueOrThrow.mockResolvedValue({
      stripeCustomerId: null,
      name: 'Test Workspace',
    });
    prismaMock.workspace.update.mockResolvedValue({});

    const res = await request(app)
      .post('/api/v1/billing/checkout')
      .set(bearer(USER_ID))
      .send({ plan: 'PRO' })
      .expect(200);

    expect(res.body.data.url).toContain('checkout.stripe.com');
    expect(customerCreateMock).toHaveBeenCalled();
    expect(checkoutCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { workspaceId: WS_ID, plan: 'PRO' },
      }),
    );
  });

  it('POST /billing/checkout returns 403 for non-owners', async () => {
    stripeEnvEnabled = true;
    prismaMock.workspaceMember.findFirst.mockResolvedValue({ role: 'MEMBER' });

    const res = await request(app)
      .post('/api/v1/billing/checkout')
      .set(bearer(USER_ID))
      .send({ plan: 'PRO' })
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('POST /billing/portal returns 400 when no billing account exists', async () => {
    stripeEnvEnabled = true;
    prismaMock.workspaceMember.findFirst.mockResolvedValue({ role: 'OWNER' });
    prismaMock.workspace.findUniqueOrThrow.mockResolvedValue({ stripeCustomerId: null });

    const res = await request(app)
      .post('/api/v1/billing/portal')
      .set(bearer(USER_ID))
      .expect(400);

    expect(res.body.error.message).toMatch(/billing account/i);
  });

  it('POST /billing/portal creates portal session for workspace owner', async () => {
    stripeEnvEnabled = true;
    prismaMock.workspaceMember.findFirst.mockResolvedValue({ role: 'OWNER' });
    prismaMock.workspace.findUniqueOrThrow.mockResolvedValue({ stripeCustomerId: 'cus_test_123' });

    const res = await request(app)
      .post('/api/v1/billing/portal')
      .set(bearer(USER_ID))
      .expect(200);

    expect(res.body.data.url).toContain('billing.stripe.com');
    expect(portalCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_test_123' }),
    );
  });

  it('POST /billing/portal returns 403 for non-owners', async () => {
    stripeEnvEnabled = true;
    prismaMock.workspaceMember.findFirst.mockResolvedValue({ role: 'MEMBER' });

    const res = await request(app)
      .post('/api/v1/billing/portal')
      .set(bearer(USER_ID))
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});
