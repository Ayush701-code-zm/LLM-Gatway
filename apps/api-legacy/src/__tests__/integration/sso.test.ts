/**
 * Integration tests for workspace SSO config and public SAML discovery routes.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Application } from 'express';

const WS_ENTERPRISE = '00000000-0000-4000-8000-000000000201';
const WS_FREE = '00000000-0000-4000-8000-000000000101';
const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const MEMBER_ID = '00000000-0000-4000-8000-000000000002';

const ENTERPRISE_WORKSPACE = {
  id: WS_ENTERPRISE,
  slug: 'acme-enterprise',
  name: 'Acme Enterprise',
  plan: 'ENTERPRISE' as const,
  ssoEnabled: true,
  ssoMetadataUrl: 'https://idp.example.com/metadata.xml',
  ssoEntityId: 'https://idp.example.com/entity',
  ssoIdpSsoUrl: 'https://idp.example.com/sso',
  ssoIdpCertPem: '-----BEGIN CERTIFICATE-----\nstub\n-----END CERTIFICATE-----',
};

const FREE_WORKSPACE = {
  id: WS_FREE,
  slug: 'smartroute-dev',
  name: 'SmartRoute Dev',
  plan: 'FREE' as const,
  ssoEnabled: false,
  ssoMetadataUrl: null,
  ssoEntityId: null,
  ssoIdpSsoUrl: null,
  ssoIdpCertPem: null,
};

const fetchIdpMetadataMock = vi.fn();

const redisMock = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  ping: vi.fn().mockResolvedValue('PONG'),
  pipeline: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([]) }),
};

const prismaMock = {
  user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
  workspace: { findUnique: vi.fn(), update: vi.fn() },
  workspaceMember: { findFirst: vi.fn() },
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

vi.mock('../../lib/sso', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../lib/sso')>();
  return {
    ...mod,
    fetchIdpMetadata: (...args: unknown[]) => fetchIdpMetadataMock(...args),
  };
});

let app: Application;

function bearer(userId: string, workspaceId = WS_ENTERPRISE) {
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

describe('Workspace SSO routes', () => {
  beforeAll(async () => { await getApp(); });
  beforeEach(() => {
    fetchIdpMetadataMock.mockReset();
    prismaMock.workspace.findUnique.mockReset();
    prismaMock.workspace.update.mockReset();
    prismaMock.workspaceMember.findFirst.mockReset();
    prismaMock.auditLog.create.mockClear();
  });

  it('GET /workspaces/current/sso returns config for enterprise admins', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue({ role: 'ADMIN' });
    prismaMock.workspace.findUnique.mockResolvedValue(ENTERPRISE_WORKSPACE);

    const res = await request(app)
      .get('/api/v1/workspaces/current/sso')
      .set(bearer(ADMIN_ID))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.enabled).toBe(true);
    expect(res.body.data.idpConfigured).toBe(true);
    expect(res.body.data.acsUrl).toContain('acme-enterprise');
  });

  it('GET /workspaces/current/sso returns 403 on non-enterprise plan', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue({ role: 'OWNER' });
    prismaMock.workspace.findUnique.mockResolvedValue(FREE_WORKSPACE);

    const res = await request(app)
      .get('/api/v1/workspaces/current/sso')
      .set(bearer(ADMIN_ID, WS_FREE))
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('PATCH /workspaces/current/sso enables SSO and writes audit log', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue({ role: 'ADMIN' });
    prismaMock.workspace.findUnique.mockResolvedValue(ENTERPRISE_WORKSPACE);
    prismaMock.workspace.update.mockResolvedValue({
      ...ENTERPRISE_WORKSPACE,
      ssoEnabled: true,
    });

    const res = await request(app)
      .patch('/api/v1/workspaces/current/sso')
      .set(bearer(ADMIN_ID))
      .send({ enabled: true })
      .expect(200);

    expect(res.body.data.enabled).toBe(true);
    expect(prismaMock.auditLog.create).toHaveBeenCalled();
  });

  it('PATCH /workspaces/current/sso parses IdP metadata URL', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue({ role: 'ADMIN' });
    prismaMock.workspace.findUnique.mockResolvedValue(ENTERPRISE_WORKSPACE);
    fetchIdpMetadataMock.mockResolvedValue({
      entryPoint: 'https://idp.example.com/sso-new',
      certPem: '-----BEGIN CERTIFICATE-----\nnew\n-----END CERTIFICATE-----',
    });
    prismaMock.workspace.update.mockResolvedValue({
      ...ENTERPRISE_WORKSPACE,
      ssoMetadataUrl: 'https://idp.example.com/new-metadata.xml',
      ssoIdpSsoUrl: 'https://idp.example.com/sso-new',
    });

    const res = await request(app)
      .patch('/api/v1/workspaces/current/sso')
      .set(bearer(ADMIN_ID))
      .send({ metadataUrl: 'https://idp.example.com/new-metadata.xml' })
      .expect(200);

    expect(fetchIdpMetadataMock).toHaveBeenCalledWith('https://idp.example.com/new-metadata.xml');
    expect(res.body.data.metadataUrl).toBe('https://idp.example.com/new-metadata.xml');
  });

  it('returns 403 for non-admin workspace members', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue({ role: 'MEMBER' });

    const res = await request(app)
      .get('/api/v1/workspaces/current/sso')
      .set(bearer(MEMBER_ID))
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('Public SAML discovery routes', () => {
  beforeAll(async () => { await getApp(); });
  beforeEach(() => {
    prismaMock.workspace.findUnique.mockReset();
  });

  it('GET /auth/saml/discover returns SSO availability for enterprise workspace', async () => {
    prismaMock.workspace.findUnique.mockResolvedValue(ENTERPRISE_WORKSPACE);

    const res = await request(app)
      .get('/api/v1/auth/saml/discover?workspace=acme-enterprise')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.enabled).toBe(true);
    expect(res.body.data.workspaceName).toBe('Acme Enterprise');
    expect(res.body.data.loginUrl).toContain('acme-enterprise');
  });

  it('GET /auth/saml/discover returns disabled for unknown workspace', async () => {
    prismaMock.workspace.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/v1/auth/saml/discover?workspace=missing-slug')
      .expect(200);

    expect(res.body.data.enabled).toBe(false);
  });

  it('GET /auth/saml/discover returns 400 without workspace param', async () => {
    const res = await request(app)
      .get('/api/v1/auth/saml/discover')
      .expect(400);

    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });

  it('GET /auth/saml/metadata returns SP metadata XML', async () => {
    prismaMock.workspace.findUnique.mockResolvedValue(ENTERPRISE_WORKSPACE);

    const res = await request(app)
      .get('/api/v1/auth/saml/metadata?workspace=acme-enterprise')
      .expect(200);

    expect(res.headers['content-type']).toContain('xml');
    expect(res.text).toContain('EntityDescriptor');
    expect(res.text).toContain('acme-enterprise');
  });
});
