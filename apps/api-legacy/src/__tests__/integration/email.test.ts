/**
 * Integration tests for transactional email flows (mocked SMTP).
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Application } from 'express';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const WS_ID = '00000000-0000-4000-8000-000000000101';

const sendPasswordResetMock = vi.fn().mockResolvedValue(true);
const sendEmailVerificationMock = vi.fn().mockResolvedValue(true);

vi.mock('../../services/email.service', () => ({
  emailService: {
    isConfigured: true,
    sendPasswordReset: (...args: unknown[]) => sendPasswordResetMock(...args),
    sendEmailVerification: (...args: unknown[]) => sendEmailVerificationMock(...args),
  },
}));

const redisMock = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  ping: vi.fn().mockResolvedValue('PONG'),
  pipeline: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([]) }),
};

const USER = {
  id:            USER_ID,
  email:         'user@example.com',
  name:          'Email User',
  hashedPassword: '$2a$12$mocked',
  emailVerified: false,
  deletedAt:     null,
  role:          'USER',
};

const prismaMock = {
  user: {
    findUnique: vi.fn(),
    findFirst:  vi.fn(),
    update:     vi.fn().mockResolvedValue(USER),
  },
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

let app: Application;

function bearer(userId = USER_ID, workspaceId = WS_ID) {
  const token = jwt.sign(
    { sub: userId, workspaceId, email: USER.email, role: 'USER' },
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

describe('Transactional email flows', () => {
  beforeAll(async () => { await getApp(); });

  beforeEach(() => {
    sendPasswordResetMock.mockClear();
    sendEmailVerificationMock.mockClear();
    prismaMock.user.findUnique.mockReset();
    prismaMock.user.findFirst.mockReset();
    prismaMock.user.update.mockResolvedValue(USER);
  });

  it('POST /auth/forgot-password sends reset email for existing user', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(USER);

    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: USER.email })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(sendPasswordResetMock).toHaveBeenCalledOnce();
    expect(sendPasswordResetMock.mock.calls[0][0]).toBe(USER.email);
  });

  it('POST /auth/forgot-password returns 200 without sending for unknown email', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'missing@example.com' })
      .expect(200);

    expect(sendPasswordResetMock).not.toHaveBeenCalled();
  });

  it('POST /auth/resend-verification sends verification email for unverified user', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      ...USER,
      emailVerified: false,
    });

    await request(app)
      .post('/api/v1/auth/resend-verification')
      .set(bearer())
      .expect(200);

    expect(sendEmailVerificationMock).toHaveBeenCalledOnce();
  });

  it('POST /auth/resend-verification skips send when already verified', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      ...USER,
      emailVerified: true,
    });

    await request(app)
      .post('/api/v1/auth/resend-verification')
      .set(bearer())
      .expect(200);

    expect(sendEmailVerificationMock).not.toHaveBeenCalled();
  });
});
