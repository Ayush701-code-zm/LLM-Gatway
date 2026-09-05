/**
 * Integration tests for SAML ACS endpoint (mocked assertion validation).
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';

const ENTERPRISE_WS = {
  id: 'ws-enterprise',
  slug: 'acme-enterprise',
  name: 'Acme Enterprise',
  plan: 'ENTERPRISE' as const,
  ssoEnabled: true,
  ssoMetadataUrl: null,
  ssoEntityId: null,
  ssoIdpSsoUrl: 'https://stub.idp.example/saml/sso',
  ssoIdpCertPem: '-----BEGIN CERTIFICATE-----\nstub\n-----END CERTIFICATE-----',
};

const prismaMock = {
  workspace: { findUnique: vi.fn() },
  user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn() },
  workspaceMember: { findFirst: vi.fn(), create: vi.fn() },
  refreshToken: { create: vi.fn() },
  auditLog: { create: vi.fn() },
  $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
};

vi.mock('@smartroute/database', () => ({ prisma: prismaMock }));

vi.mock('../../config/redis', () => ({
  getRedis: () => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    ping: vi.fn().mockResolvedValue('PONG'),
    pipeline: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([]) }),
  }),
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

const validateSamlResponseMock = vi.fn().mockResolvedValue({
  email: 'sso-user@example.com',
  name: 'SSO User',
});

vi.mock('../../services/saml.service', () => ({
  validateSamlResponse: (...args: unknown[]) => validateSamlResponseMock(...args),
  createSamlLoginRedirect: vi.fn().mockResolvedValue('https://idp.example/sso'),
}));

const loginOrRegisterSamlMock = vi.fn().mockResolvedValue({
  user: {
    id: 'user-sso',
    email: 'sso-user@example.com',
    name: 'SSO User',
    avatarUrl: null,
    role: 'USER',
    emailVerified: true,
    mfaEnabled: false,
    workspaces: [{ id: ENTERPRISE_WS.id, slug: ENTERPRISE_WS.slug, name: ENTERPRISE_WS.name, role: 'MEMBER' }],
  },
  tokens: {
    accessToken: 'sso-access-token',
    refreshToken: 'sso-refresh-token',
    expiresIn: 900,
  },
});

vi.mock('../../services/auth.service', () => ({
  authService: { loginOrRegisterSaml: (...args: unknown[]) => loginOrRegisterSamlMock(...args) },
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
  a.use(express.urlencoded({ extended: false }));
  a.use(express.json());
  a.use(requestContextMiddleware);
  a.use(metricsMiddleware);
  registerRoutes(a);
  a.use(notFoundHandler);
  a.use(errorHandler);
  app = a;
  return app;
}

describe('POST /api/v1/auth/saml/acs', () => {
  beforeAll(async () => { await getApp(); });

  it('redirects to web callback after valid SAML response', async () => {
    prismaMock.workspace.findUnique.mockResolvedValueOnce(ENTERPRISE_WS);

    const res = await request(app)
      .post('/api/v1/auth/saml/acs?workspace=acme-enterprise')
      .type('form')
      .send({ SAMLResponse: 'mock-assertion-base64' })
      .expect(302);

    expect(res.headers.location).toContain('/saml/callback');
    expect(res.headers.location).toContain('accessToken=sso-access-token');
    expect(validateSamlResponseMock).toHaveBeenCalled();
    expect(loginOrRegisterSamlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'sso-user@example.com',
        workspaceId: ENTERPRISE_WS.id,
      }),
    );
  });

  it('returns 404 when SSO is disabled for workspace', async () => {
    prismaMock.workspace.findUnique.mockResolvedValueOnce({
      ...ENTERPRISE_WS,
      ssoEnabled: false,
    });

    const res = await request(app)
      .post('/api/v1/auth/saml/acs?workspace=acme-enterprise')
      .type('form')
      .send({ SAMLResponse: 'mock' })
      .expect(404);

    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
