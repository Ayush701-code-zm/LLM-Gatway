/**
 * Integration tests for POST /billing/webhook (Stripe signature + routing).
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';

const constructEventMock = vi.fn();
const handleStripeEventMock = vi.fn().mockResolvedValue(undefined);

vi.mock('stripe', () => ({
  default: class StripeMock {
    webhooks = { constructEvent: (...args: unknown[]) => constructEventMock(...args) };
  },
}));

vi.mock('../../lib/stripeWebhook', () => ({
  handleStripeEvent: (...args: unknown[]) => handleStripeEventMock(...args),
}));

const redisMock = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  ping: vi.fn().mockResolvedValue('PONG'),
  pipeline: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([]) }),
};

const prismaMock = {
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
let stripeWebhookEnabled = false;

vi.mock('../../config/env', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../config/env')>();
  return {
    env: new Proxy(mod.env, {
      get(target, prop, receiver) {
        if (prop === 'STRIPE_SECRET_KEY') {
          return stripeWebhookEnabled ? 'sk_test_mock' : undefined;
        }
        if (prop === 'STRIPE_WEBHOOK_SECRET') {
          return stripeWebhookEnabled ? 'whsec_test_mock' : undefined;
        }
        return Reflect.get(target, prop, receiver);
      },
    }),
  };
});

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

describe('POST /billing/webhook', () => {
  beforeAll(async () => { await getApp(); });
  beforeEach(() => {
    stripeWebhookEnabled = false;
    constructEventMock.mockReset();
    handleStripeEventMock.mockClear();
  });

  it('returns 503 when Stripe webhook secret is not configured', async () => {
    const res = await request(app)
      .post('/api/v1/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'sig_test')
      .send('{"id":"evt_test"}')
      .expect(503);

    expect(res.body.error.message).toMatch(/not configured/i);
  });

  it('returns 400 when signature verification fails', async () => {
    stripeWebhookEnabled = true;
    constructEventMock.mockImplementationOnce(() => {
      throw new Error('Invalid signature');
    });

    const res = await request(app)
      .post('/api/v1/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'bad_sig')
      .send('{"id":"evt_test"}')
      .expect(400);

    expect(res.body.error.message).toMatch(/Invalid signature/);
    expect(handleStripeEventMock).not.toHaveBeenCalled();
  });

  it('returns 200 and processes verified Stripe events', async () => {
    stripeWebhookEnabled = true;
    const event = {
      id: 'evt_checkout_ok',
      type: 'checkout.session.completed',
      data: { object: { metadata: { workspaceId: 'ws-1', plan: 'PRO' } } },
    };
    constructEventMock.mockReturnValueOnce(event);

    const res = await request(app)
      .post('/api/v1/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'sig_valid')
      .send(JSON.stringify(event))
      .expect(200);

    expect(res.body.received).toBe(true);
    expect(constructEventMock).toHaveBeenCalled();
    expect(handleStripeEventMock).toHaveBeenCalledWith(event);
  });
});
