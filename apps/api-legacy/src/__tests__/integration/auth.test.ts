/**
 * Integration tests for Auth routes.
 *
 * Spins up the full Express app with all middleware and real route handlers.
 * External dependencies (Prisma, Redis, BullMQ, Prometheus) are mocked.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Application } from 'express';

// ── Singleton mocks (all must be defined BEFORE vi.mock calls) ────

const redisMock = {
  get:      vi.fn().mockResolvedValue(null),
  set:      vi.fn().mockResolvedValue('OK'),
  setex:    vi.fn().mockResolvedValue('OK'),
  del:      vi.fn().mockResolvedValue(1),
  ping:     vi.fn().mockResolvedValue('PONG'),  // health check
  pipeline: vi.fn().mockReturnValue({
    incr:   vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec:   vi.fn().mockResolvedValue([[null, 1],[null,true],[null,1],[null,true]]),
  }),
};

const USER = {
  id:              'user-001',
  email:           'test@example.com',
  name:            'Test User',
  hashedPassword:  '$2a$12$placeholder',
  emailVerified:   true,
  role:            'USER',
  avatarUrl:       null,
  deletedAt:       null,
  lastLoginAt:     null,
  createdAt:       new Date(),
  updatedAt:       new Date(),
  workspaceMemberships: [
    {
      role:      'OWNER',
      workspace: { id: 'ws-001', slug: 'test-workspace', name: "Test Workspace" },
    },
  ],
};

const WORKSPACE = { id: 'ws-001', slug: 'test-workspace', name: "Test Workspace" };

const prismaMock = {
  user: {
    findUnique:          vi.fn(),
    findUniqueOrThrow:   vi.fn(),
    findFirst:           vi.fn(),
    create:              vi.fn(),
    update:              vi.fn().mockResolvedValue(USER),
  },
  workspace: {
    create: vi.fn().mockResolvedValue(WORKSPACE),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn().mockResolvedValue({
      plan: 'FREE',
      requestsPerMinute: null,
      requestsPerDay: null,
      tokensPerMinute: null,
    }),
  },
  workspaceMember:        { findFirst: vi.fn(), findMany: vi.fn() },
  workspaceMembership:    { findMany: vi.fn() },
  rateLimit:              { upsert: vi.fn().mockResolvedValue({}) },
  refreshToken:           {
    create:      vi.fn().mockResolvedValue({}),
    findUnique:  vi.fn(),
    findMany:    vi.fn(),
    delete:      vi.fn(),
  },
  auditLog:               { create: vi.fn().mockResolvedValue({}) },
  budget:                 { create: vi.fn().mockResolvedValue({}) },
  $queryRaw:              vi.fn().mockResolvedValue([{ '?column?': 1 }]),  // health check
  $transaction:           vi.fn(),
};

// ── vi.mock calls (hoisted — singleton references used safely) ────

vi.mock('@smartroute/database', () => ({ prisma: prismaMock }));

vi.mock('../../config/redis', () => ({
  getRedis: () => redisMock,
  getBullMQConnectionOptions: () => ({ host: 'localhost', port: 6379 }),
}));

vi.mock('../../queues/index', () => ({
  startWorkers:            vi.fn(),
  scheduleRecurringJobs:   vi.fn(),
  getQueues:               vi.fn().mockReturnValue({}),
  enqueueAnalyticsEvent:   vi.fn(),
  triggerDailyAggregation: vi.fn(),
}));

vi.mock('../../config/metrics', () => ({
  register:                 { contentType: 'text/plain', metrics: vi.fn().mockResolvedValue('') },
  httpRequestDuration:      { startTimer: vi.fn().mockReturnValue(vi.fn()) },
  llmRequestDuration:       { observe: vi.fn() },
  llmRequestsTotal:         { inc: vi.fn() },
  llmCostUsd:               { inc: vi.fn() },
  llmSavingsUsd:            { inc: vi.fn() },
  cacheHitsTotal:           { inc: vi.fn() },
  cacheMissesTotal:         { inc: vi.fn() },
  cacheHitRate:             { set: vi.fn() },
  rateLimitedRequestsTotal: { inc: vi.fn() },
  fallbackEventsTotal:      { inc: vi.fn() },
  circuitBreakerState:      { set: vi.fn() },
  providerAvailability:     { set: vi.fn() },
  queueDepth:               { set: vi.fn() },
  activeConnections:        { set: vi.fn() },
  collectDefaultMetrics:    vi.fn(),
}));

vi.mock('bcryptjs', () => ({
  default: { hash: vi.fn().mockResolvedValue('$2a$12$mocked'), compare: vi.fn() },
  hash:    vi.fn().mockResolvedValue('$2a$12$mocked'),
  compare: vi.fn(),
}));

// ── App factory ───────────────────────────────────────────────────

let app: Application;

async function getApp(): Promise<Application> {
  if (app) return app;
  const express     = (await import('express')).default;
  const helmet      = (await import('helmet')).default;
  const cors        = (await import('cors')).default;
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

// ══════════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════════

describe('POST /api/v1/auth/register', () => {
  beforeAll(async () => { await getApp(); });

  it('returns 400 for missing required fields', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'test@example.com' })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid email format', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Test', email: 'not-an-email', password: 'password123' })
      .expect(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 for password shorter than 8 chars', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Test', email: 'test@example.com', password: 'short' })
      .expect(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 409 when email already exists', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(USER);
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Test', email: 'test@example.com', password: 'password123' })
      .expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('returns 400 for invalid workspace slug', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Test',
        email: 'test@example.com',
        password: 'password123',
        workspaceSlug: 'Bad Slug!',
      })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for reserved workspace slug', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Test',
        email: 'test@example.com',
        password: 'password123',
        workspaceSlug: 'admin',
      })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/reserved/i);
  });

  it('returns 409 when workspace slug is taken', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    prismaMock.workspace.findUnique.mockResolvedValueOnce({ id: 'existing-ws' });

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Test',
        email: 'new@example.com',
        password: 'password123',
        workspaceSlug: 'my-company',
      })
      .expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('returns 201 with tokens for valid registration', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    prismaMock.$transaction.mockImplementationOnce(async (fn: (tx: typeof prismaMock) => Promise<unknown>) => {
      const fakeTx = {
        user:      { create: vi.fn().mockResolvedValue(USER) },
        workspace: { create: vi.fn().mockResolvedValue(WORKSPACE) },
        workspaceMembership: { create: vi.fn().mockResolvedValue({}) },
        budget:    { create: vi.fn().mockResolvedValue({}) },
        auditLog:  { create: vi.fn().mockResolvedValue({}) },
      };
      return fn(fakeTx as never);
    });
    prismaMock.user.findUniqueOrThrow
      .mockResolvedValueOnce(USER)
      .mockResolvedValueOnce(USER);
    prismaMock.user.findUnique.mockResolvedValueOnce(USER);
    prismaMock.user.update.mockResolvedValueOnce(USER);
    prismaMock.refreshToken.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'New User', email: 'new@example.com', password: 'password123' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.tokens).toHaveProperty('accessToken');
    expect(res.body.data.tokens).toHaveProperty('refreshToken');
    expect(res.body.data.tokens.expiresIn).toBeTypeOf('number');
  });
});

describe('POST /api/v1/auth/login', () => {
  beforeAll(async () => { await getApp(); });

  it('returns 400 for missing password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'test@example.com' })
      .expect(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 for non-existent user (code=UNAUTHORIZED)', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'password123' })
      .expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 for wrong password', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(USER);
    const bcrypt = await import('bcryptjs');
    // The service does `import bcrypt from 'bcryptjs'` → uses default.compare
    vi.mocked(bcrypt.default.compare).mockResolvedValueOnce(false as never);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'test@example.com', password: 'wrongpassword' })
      .expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 200 with tokens for valid credentials', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(USER);
    const bcrypt = await import('bcryptjs');
    vi.mocked(bcrypt.default.compare).mockResolvedValueOnce(true as never);

    prismaMock.workspaceMember.findFirst.mockResolvedValueOnce({ workspaceId: 'ws-001' });
    prismaMock.user.update.mockResolvedValueOnce(USER);
    prismaMock.user.findUniqueOrThrow
      .mockResolvedValueOnce(USER)
      .mockResolvedValueOnce(USER);
    prismaMock.refreshToken.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'test@example.com', password: 'correctpassword' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.tokens.accessToken).toBeTruthy();
    expect(res.body.data.tokens.expiresIn).toBeTypeOf('number');
  });

  it('attaches X-Request-ID header', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'test@example.com', password: 'pw' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});

describe('GET /health', () => {
  beforeAll(async () => { await getApp(); });

  it('returns 200 when all checks pass', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ 1: 1 }]);
    redisMock.ping.mockResolvedValueOnce('PONG');
    const res = await request(app).get('/health').expect(200);
    expect(res.body).toHaveProperty('status');
    expect(res.body.checks).toHaveProperty('database');
    expect(res.body.checks).toHaveProperty('redis');
  });
});

describe('GET /health/live', () => {
  beforeAll(async () => { await getApp(); });

  it('always returns 200 alive', async () => {
    const res = await request(app).get('/health/live').expect(200);
    expect(res.body.status).toBe('alive');
  });
});

describe('GET /health/ready', () => {
  beforeAll(async () => { await getApp(); });

  it('returns 200 when database is reachable', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ 1: 1 }]);
    const res = await request(app).get('/health/ready').expect(200);
    expect(res.body.status).toBe('ready');
  });
});

const SWITCH_WS_001 = '00000000-0000-4000-8000-000000000101';
const SWITCH_WS_002 = '00000000-0000-4000-8000-000000000102';

function switchBearer(userId: string, workspaceId = SWITCH_WS_001) {
  const token = jwt.sign(
    { sub: userId, workspaceId, email: 'test@example.com', role: 'USER' },
    process.env.JWT_SECRET!,
    { expiresIn: '15m' },
  );
  return { Authorization: `Bearer ${token}` };
}

describe('POST /api/v1/auth/switch-workspace', () => {
  beforeAll(async () => { await getApp(); });
  beforeEach(() => {
    prismaMock.workspaceMember.findFirst.mockReset();
    prismaMock.user.findUniqueOrThrow.mockReset();
    prismaMock.refreshToken.create.mockClear();
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app)
      .post('/api/v1/auth/switch-workspace')
      .send({ workspaceId: SWITCH_WS_002 })
      .expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 400 for invalid workspaceId', async () => {
    const res = await request(app)
      .post('/api/v1/auth/switch-workspace')
      .set(switchBearer(USER.id))
      .send({ workspaceId: 'not-a-uuid' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 403 when user is not a member of the workspace', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/v1/auth/switch-workspace')
      .set(switchBearer(USER.id))
      .send({ workspaceId: SWITCH_WS_002 })
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 200 with new tokens when switching to a member workspace', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValueOnce({ role: 'ADMIN' });
    prismaMock.user.findUniqueOrThrow
      .mockResolvedValueOnce({ email: USER.email })
      .mockResolvedValueOnce({ role: USER.role })
      .mockResolvedValueOnce({
        id: USER.id,
        email: USER.email,
        name: USER.name,
        avatarUrl: USER.avatarUrl,
        role: USER.role,
        emailVerified: USER.emailVerified,
        mfaEnabled: false,
        workspaceMemberships: [
          {
            role: 'OWNER',
            workspace: { id: SWITCH_WS_001, slug: 'test-workspace', name: 'Test Workspace' },
          },
          {
            role: 'ADMIN',
            workspace: { id: SWITCH_WS_002, slug: 'other-workspace', name: 'Other Workspace' },
          },
        ],
      });
    prismaMock.refreshToken.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/v1/auth/switch-workspace')
      .set(switchBearer(USER.id))
      .send({ workspaceId: SWITCH_WS_002 })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.tokens.accessToken).toBeTruthy();
    expect(res.body.data.tokens.refreshToken).toBeTruthy();
    expect(res.body.data.user.workspaces).toHaveLength(2);
    expect(prismaMock.refreshToken.create).toHaveBeenCalled();
  });
});

describe('GET /api/v1/auth/me/export', () => {
  beforeAll(async () => { await getApp(); });
  beforeEach(() => {
    prismaMock.user.findFirst.mockReset();
    prismaMock.workspaceMember.findMany.mockReset();
    prismaMock.refreshToken.findMany.mockReset();
  });

  it('returns JSON attachment with profile, workspaces, and sessions', async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: USER.id,
      email: USER.email,
      name: USER.name,
      role: USER.role,
      emailVerified: USER.emailVerified,
      mfaEnabled: false,
      avatarUrl: USER.avatarUrl,
      createdAt: USER.createdAt,
      lastLoginAt: USER.lastLoginAt,
    });
    prismaMock.workspaceMember.findMany.mockResolvedValueOnce([
      {
        role: 'OWNER',
        joinedAt: new Date('2025-01-01T00:00:00.000Z'),
        workspace: { id: 'ws-001', slug: 'test-workspace', name: 'Test Workspace', plan: 'FREE' },
      },
    ]);
    prismaMock.refreshToken.findMany.mockResolvedValueOnce([
      {
        id: 'rt-001',
        createdAt: new Date('2025-06-01T00:00:00.000Z'),
        expiresAt: new Date('2025-06-08T00:00:00.000Z'),
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      },
    ]);

    const res = await request(app)
      .get('/api/v1/auth/me/export')
      .set(switchBearer(USER.id))
      .expect(200);

    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-disposition']).toContain('attachment');
    const body = JSON.parse(res.text);
    expect(body.user.email).toBe(USER.email);
    expect(body.workspaces).toHaveLength(1);
    expect(body.sessions).toHaveLength(1);
    expect(body.exportedAt).toBeTruthy();
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me/export')
      .expect(401);

    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});
