/**
 * Integration tests for Member lifecycle routes (transfer ownership, leave).
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Application } from 'express';

const redisMock = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  setex: vi.fn().mockResolvedValue('OK'),
  del: vi.fn().mockResolvedValue(1),
  ping: vi.fn().mockResolvedValue('PONG'),
  pipeline: vi.fn().mockReturnValue({
    incr: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([[null, 1], [null, true]]),
  }),
};

const WS_ID = 'ws-001';
const OWNER_ID = 'owner-001';
const ADMIN_ID = 'admin-001';
const MEMBER_ID = 'member-001';

const switchWorkspaceMock = vi.fn().mockResolvedValue({
  user: {
    id: MEMBER_ID,
    email: 'member@example.com',
    name: 'Member User',
    avatarUrl: null,
    role: 'USER',
    emailVerified: true,
    mfaEnabled: false,
    workspaces: [{ id: 'ws-002', slug: 'other-ws', name: 'Other', role: 'OWNER' }],
  },
  tokens: {
    accessToken: 'switched-access',
    refreshToken: 'switched-refresh',
    expiresIn: 900,
  },
});

const prismaMock = {
  user: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  workspace: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
  },
  workspaceMember: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    create: vi.fn(),
  },
  workspaceMembership: { findMany: vi.fn() },
  rateLimit: { upsert: vi.fn() },
  refreshToken: { create: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
  budget: { create: vi.fn() },
  $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
  $transaction: vi.fn(),
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

vi.mock('../../services/auth.service', () => ({
  authService: { switchWorkspace: switchWorkspaceMock },
}));

let app: Application;

function bearer(userId: string, workspaceId = WS_ID, email = 'owner@example.com') {
  const token = jwt.sign(
    { sub: userId, workspaceId, email, role: 'USER' },
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

function mockMembershipLookup(
  roles: Record<string, { id: string; role: string; user?: { id: string; name: string; email: string } }>,
) {
  prismaMock.workspaceMember.findFirst.mockImplementation(async (args: { where?: { userId?: string } }) => {
    const userId = args?.where?.userId;
    if (!userId) return null;
    const entry = roles[userId];
    if (!entry) return null;
    return { userId, ...entry };
  });
}

describe('POST /api/v1/workspaces/current/members/:userId/transfer-ownership', () => {
  beforeAll(async () => { await getApp(); });
  beforeEach(() => {
    switchWorkspaceMock.mockClear();
    prismaMock.workspaceMember.findFirst.mockReset();
    prismaMock.workspaceMember.count.mockReset();
    prismaMock.$transaction.mockReset();
    prismaMock.auditLog.create.mockClear();
  });

  it('transfers ownership from owner to another member', async () => {
    mockMembershipLookup({
      [OWNER_ID]: { id: 'm-owner', role: 'OWNER' },
      [ADMIN_ID]: {
        id: 'm-target',
        role: 'ADMIN',
        user: { id: ADMIN_ID, name: 'Admin', email: 'admin@example.com' },
      },
    });

    prismaMock.$transaction.mockResolvedValueOnce([
      { id: 'm-owner', role: 'ADMIN', userId: OWNER_ID, user: { id: OWNER_ID, name: 'Owner', email: 'owner@example.com' } },
      { id: 'm-target', role: 'OWNER', userId: ADMIN_ID, user: { id: ADMIN_ID, name: 'Admin', email: 'admin@example.com' } },
    ]);

    const res = await request(app)
      .post(`/api/v1/workspaces/current/members/${ADMIN_ID}/transfer-ownership`)
      .set(bearer(OWNER_ID))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.newOwner.role).toBe('OWNER');
    expect(res.body.data.previousOwner.role).toBe('ADMIN');
    expect(prismaMock.auditLog.create).toHaveBeenCalled();
  });

  it('returns 400 when transferring to yourself', async () => {
    mockMembershipLookup({ [OWNER_ID]: { id: 'm-owner', role: 'OWNER' } });

    const res = await request(app)
      .post(`/api/v1/workspaces/current/members/${OWNER_ID}/transfer-ownership`)
      .set(bearer(OWNER_ID))
      .expect(400);

    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });

  it('returns 403 when caller is not owner', async () => {
    mockMembershipLookup({
      [ADMIN_ID]: { id: 'm-admin', role: 'ADMIN' },
      [MEMBER_ID]: { id: 'm-target', role: 'MEMBER' },
    });

    const res = await request(app)
      .post(`/api/v1/workspaces/current/members/${MEMBER_ID}/transfer-ownership`)
      .set(bearer(ADMIN_ID))
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('POST /api/v1/workspaces/current/members/leave', () => {
  beforeAll(async () => { await getApp(); });
  beforeEach(() => {
    switchWorkspaceMock.mockClear();
    prismaMock.workspaceMember.findFirst.mockReset();
    prismaMock.workspaceMember.count.mockReset();
    prismaMock.workspaceMember.delete.mockReset();
    prismaMock.workspace.findUniqueOrThrow.mockReset();
    prismaMock.$transaction.mockReset();
    prismaMock.auditLog.create.mockClear();
  });

  it('allows a non-owner to leave and switches workspace', async () => {
    mockMembershipLookup({ [MEMBER_ID]: { id: 'm-member', role: 'MEMBER' } });

    prismaMock.workspace.findUniqueOrThrow.mockResolvedValueOnce({
      name: 'Test Workspace',
      deletedAt: null,
    });
    prismaMock.workspaceMember.delete.mockResolvedValueOnce({ id: 'm-member', role: 'MEMBER', userId: MEMBER_ID });
    prismaMock.workspaceMember.findFirst.mockImplementation(async (args: { where?: { userId?: string; workspaceId?: string } }) => {
      if (args?.where?.userId === MEMBER_ID && args?.where?.workspaceId === WS_ID) {
        return { id: 'm-member', role: 'MEMBER', userId: MEMBER_ID };
      }
      if (args?.where?.userId === MEMBER_ID && !args?.where?.workspaceId) {
        return { workspaceId: 'ws-002' };
      }
      return null;
    });

    const res = await request(app)
      .post('/api/v1/workspaces/current/members/leave')
      .set(bearer(MEMBER_ID, WS_ID, 'member@example.com'))
      .expect(200);

    expect(res.body.data.left).toBe(true);
    expect(res.body.data.tokens.accessToken).toBe('switched-access');
    expect(switchWorkspaceMock).toHaveBeenCalledWith(MEMBER_ID, 'ws-002');
  });

  it('blocks owner leave when other members remain', async () => {
    mockMembershipLookup({ [OWNER_ID]: { id: 'm-owner', role: 'OWNER' } });
    prismaMock.workspace.findUniqueOrThrow.mockResolvedValueOnce({
      name: 'Test Workspace',
      deletedAt: null,
    });
    prismaMock.workspaceMember.count.mockResolvedValueOnce(2);

    const res = await request(app)
      .post('/api/v1/workspaces/current/members/leave')
      .set(bearer(OWNER_ID))
      .expect(409);

    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('deactivates workspace when sole owner leaves', async () => {
    mockMembershipLookup({ [OWNER_ID]: { id: 'm-owner', role: 'OWNER' } });
    prismaMock.workspace.findUniqueOrThrow.mockResolvedValueOnce({
      name: 'Solo Workspace',
      deletedAt: null,
    });
    prismaMock.workspaceMember.count.mockResolvedValueOnce(0);
    prismaMock.$transaction.mockResolvedValueOnce([]);
    prismaMock.workspaceMember.findFirst.mockImplementation(async (args: { where?: { userId?: string; workspaceId?: string } }) => {
      if (args?.where?.userId === OWNER_ID && args?.where?.workspaceId === WS_ID) {
        return { id: 'm-owner', role: 'OWNER', userId: OWNER_ID };
      }
      return null;
    });

    const res = await request(app)
      .post('/api/v1/workspaces/current/members/leave')
      .set(bearer(OWNER_ID))
      .expect(200);

    expect(res.body.data.left).toBe(true);
    expect(res.body.data.workspaceDeactivated).toBe(true);
    expect(res.body.data.noWorkspacesRemaining).toBe(true);
  });
});
