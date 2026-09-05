/**
 * Integration tests for MFA auth routes.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Application } from 'express';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const WS_ID = '00000000-0000-4000-8000-000000000101';
const MFA_SECRET = 'JBSWY3DPEHPK3PXP';

const verifyMock = vi.fn().mockResolvedValue(true);

vi.mock('otplib', () => ({
  generateSecret: vi.fn().mockReturnValue(MFA_SECRET),
  generateURI: vi.fn().mockReturnValue(
    `otpauth://totp/SmartRoute:test@example.com?secret=${MFA_SECRET}&issuer=SmartRoute`,
  ),
  verify: (...args: unknown[]) => verifyMock(...args),
}));

vi.mock('../../lib/crypto', () => ({
  encryptSecret: (value: string) => `enc:${value}`,
  decryptSecret: (value: string) => value.replace(/^enc:/, ''),
}));

const redisMock = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  ping: vi.fn().mockResolvedValue('PONG'),
  pipeline: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([]) }),
};

const userState = {
  id: USER_ID,
  email: 'mfa-user@example.com',
  name: 'MFA User',
  avatarUrl: null,
  role: 'USER',
  emailVerified: true,
  mfaEnabled: false,
  mfaSecretEncrypted: null as string | null,
  mfaBackupCodesHash: null as string[] | null,
  hashedPassword: '$2a$12$mock',
  deletedAt: null,
};

const prismaMock = {
  user: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
  },
  workspaceMember: { findFirst: vi.fn() },
  refreshToken: { create: vi.fn().mockResolvedValue({}) },
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

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('$2a$12$mock'),
    compare: vi.fn().mockResolvedValue(true),
  },
  hash: vi.fn().mockResolvedValue('$2a$12$mock'),
  compare: vi.fn().mockResolvedValue(true),
}));

let app: Application;

function bearer(userId: string, workspaceId = WS_ID) {
  const token = jwt.sign(
    { sub: userId, workspaceId, email: userState.email, role: 'USER' },
    process.env.JWT_SECRET!,
    { expiresIn: '15m' },
  );
  return { Authorization: `Bearer ${token}` };
}

function authUserPayload() {
  return {
    id: userState.id,
    email: userState.email,
    name: userState.name,
    avatarUrl: userState.avatarUrl,
    role: userState.role,
    emailVerified: userState.emailVerified,
    mfaEnabled: userState.mfaEnabled,
    workspaces: [{ id: WS_ID, slug: 'test-ws', name: 'Test', role: 'OWNER' }],
  };
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

describe('MFA routes', () => {
  beforeAll(async () => { await getApp(); });
  beforeEach(() => {
    userState.mfaEnabled = false;
    userState.mfaSecretEncrypted = null;
    userState.mfaBackupCodesHash = null;
    verifyMock.mockClear();
    verifyMock.mockResolvedValue(true);

    prismaMock.user.findUnique.mockImplementation(({ where, select }: {
      where: { id?: string };
      select?: Record<string, boolean>;
    }) => {
      if (where.id !== USER_ID) return Promise.resolve(null);
      if (select?.hashedPassword) {
        return Promise.resolve({ hashedPassword: userState.hashedPassword });
      }
      if (select?.mfaSecretEncrypted) {
        return Promise.resolve({
          mfaSecretEncrypted: userState.mfaSecretEncrypted,
          mfaBackupCodesHash: userState.mfaBackupCodesHash,
        });
      }
      if (select?.mfaEnabled) {
        return Promise.resolve({ mfaEnabled: userState.mfaEnabled, deletedAt: null });
      }
      return Promise.resolve(null);
    });

    prismaMock.user.findUniqueOrThrow.mockImplementation(({ where, select }: {
      where: { id?: string };
      select?: Record<string, unknown>;
    }) => {
      if (where.id !== USER_ID) return Promise.reject(new Error('not found'));

      if (select?.workspaceMemberships) {
        return Promise.resolve({
          id: userState.id,
          email: userState.email,
          name: userState.name,
          avatarUrl: userState.avatarUrl,
          role: userState.role,
          emailVerified: userState.emailVerified,
          mfaEnabled: userState.mfaEnabled,
          workspaceMemberships: [{
            role: 'OWNER',
            workspace: { id: WS_ID, slug: 'test-ws', name: 'Test' },
          }],
        });
      }

      if (select?.email && !select?.id) {
        return Promise.resolve({ email: userState.email, mfaEnabled: userState.mfaEnabled });
      }

      if (select?.mfaEnabled && !select?.workspaceMemberships) {
        return Promise.resolve({
          mfaEnabled: userState.mfaEnabled,
          mfaBackupCodesHash: userState.mfaBackupCodesHash,
        });
      }

      if (select?.mfaSecretEncrypted) {
        return Promise.resolve({
          mfaSecretEncrypted: userState.mfaSecretEncrypted,
          mfaBackupCodesHash: userState.mfaBackupCodesHash,
        });
      }

      if (select?.role) {
        return Promise.resolve({ role: userState.role });
      }

      return Promise.resolve(authUserPayload());
    });

    prismaMock.user.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      if (data.mfaSecretEncrypted !== undefined) {
        userState.mfaSecretEncrypted = data.mfaSecretEncrypted as string | null;
      }
      if (data.mfaEnabled !== undefined) {
        userState.mfaEnabled = data.mfaEnabled as boolean;
      }
      if (data.mfaBackupCodesHash !== undefined) {
        userState.mfaBackupCodesHash = data.mfaBackupCodesHash as string[] | null;
      }
      return Promise.resolve(userState);
    });

    prismaMock.workspaceMember.findFirst.mockResolvedValue({ workspaceId: WS_ID });
  });

  it('GET /auth/mfa/status returns disabled by default', async () => {
    const res = await request(app)
      .get('/api/v1/auth/mfa/status')
      .set(bearer(USER_ID))
      .expect(200);

    expect(res.body.data.enabled).toBe(false);
  });

  it('POST /auth/mfa/setup returns otpauth URL and secret', async () => {
    const res = await request(app)
      .post('/api/v1/auth/mfa/setup')
      .set(bearer(USER_ID))
      .expect(200);

    expect(res.body.data.secret).toBe(MFA_SECRET);
    expect(res.body.data.otpauthUrl).toContain('otpauth://');
    expect(userState.mfaSecretEncrypted).toBe(`enc:${MFA_SECRET}`);
  });

  it('POST /auth/mfa/confirm enables MFA and returns backup codes', async () => {
    userState.mfaSecretEncrypted = `enc:${MFA_SECRET}`;

    const res = await request(app)
      .post('/api/v1/auth/mfa/confirm')
      .set(bearer(USER_ID))
      .send({ code: '123456' })
      .expect(200);

    expect(res.body.data.backupCodes).toHaveLength(8);
    expect(res.body.data.user.mfaEnabled).toBe(true);
    expect(userState.mfaEnabled).toBe(true);
    expect(verifyMock).toHaveBeenCalled();
  });
});
