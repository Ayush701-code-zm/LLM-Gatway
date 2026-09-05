/**
 * Integration tests for member list, invite, role update, and removal routes.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Application } from 'express';

const WS_ID = 'ws-001';
const ADMIN_ID = 'admin-001';
const MEMBER_ID = 'member-001';
const TARGET_ID = 'target-001';

const INVITE_TOKEN = 'a'.repeat(32);
const PENDING_INVITE = {
  token: INVITE_TOKEN,
  workspaceId: WS_ID,
  email: 'invitee@example.com',
  role: 'MEMBER' as const,
  invitedBy: ADMIN_ID,
  invitedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
};

const storeInviteMock = vi.fn().mockResolvedValue(undefined);
const getInviteMock = vi.fn();
const deleteInviteMock = vi.fn().mockResolvedValue(undefined);
const listWorkspaceInvitesMock = vi.fn();

const switchWorkspaceMock = vi.fn().mockResolvedValue({
  user: {
    id: MEMBER_ID,
    email: 'invitee@example.com',
    name: 'Invitee',
    avatarUrl: null,
    role: 'USER',
    emailVerified: true,
    mfaEnabled: false,
    workspaces: [{ id: WS_ID, slug: 'test-ws', name: 'Test', role: 'MEMBER' }],
  },
  tokens: {
    accessToken: 'new-access',
    refreshToken: 'new-refresh',
    expiresIn: 900,
  },
});

const redisMock = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  ping: vi.fn().mockResolvedValue('PONG'),
  pipeline: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([]) }),
};

const prismaMock = {
  user: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
  workspace: {
    findUniqueOrThrow: vi.fn(),
  },
  workspaceMember: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    create: vi.fn(),
  },
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

vi.mock('../../lib/planEnforcement', () => ({
  enforceMemberLimit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/invites', () => ({
  storeInvite: storeInviteMock,
  getInvite: getInviteMock,
  deleteInvite: deleteInviteMock,
  listWorkspaceInvites: listWorkspaceInvitesMock,
}));

vi.mock('../../services/email.service', () => ({
  emailService: { sendMemberInvite: vi.fn().mockResolvedValue(true) },
}));

vi.mock('../../services/auth.service', () => ({
  authService: { switchWorkspace: switchWorkspaceMock },
}));

let app: Application;

function bearer(userId: string, workspaceId = WS_ID, email = 'admin@example.com') {
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

function mockAdminRole(userId = ADMIN_ID) {
  prismaMock.workspaceMember.findFirst.mockImplementation(async (args: { where?: { userId?: string } }) => {
    if (args?.where?.userId === userId) {
      return { id: 'm-admin', role: 'ADMIN', userId };
    }
    return null;
  });
}

describe('Member CRUD routes', () => {
  beforeAll(async () => { await getApp(); });
  beforeEach(() => {
    storeInviteMock.mockClear();
    getInviteMock.mockReset();
    deleteInviteMock.mockClear();
    listWorkspaceInvitesMock.mockReset();
    switchWorkspaceMock.mockClear();
    prismaMock.workspaceMember.findFirst.mockReset();
    prismaMock.workspaceMember.findMany.mockReset();
    prismaMock.workspaceMember.update.mockReset();
    prismaMock.workspaceMember.delete.mockReset();
    prismaMock.workspaceMember.create.mockReset();
    prismaMock.user.findUnique.mockReset();
    prismaMock.user.findUniqueOrThrow.mockReset();
    prismaMock.workspace.findUniqueOrThrow.mockReset();
    prismaMock.auditLog.create.mockClear();
  });

  it('GET /workspaces/current/members returns member list', async () => {
    mockAdminRole();
    prismaMock.workspaceMember.findMany.mockResolvedValue([
      {
        id: 'm-admin',
        role: 'ADMIN',
        userId: ADMIN_ID,
        user: { id: ADMIN_ID, name: 'Admin', email: 'admin@example.com', avatarUrl: null, lastLoginAt: null },
      },
    ]);

    const res = await request(app)
      .get('/api/v1/workspaces/current/members')
      .set(bearer(ADMIN_ID))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].role).toBe('ADMIN');
  });

  it('POST /workspaces/current/members/invite creates pending invite', async () => {
    mockAdminRole();
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.workspace.findUniqueOrThrow.mockResolvedValue({ name: 'Test Workspace' });
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({ name: 'Admin User' });

    const res = await request(app)
      .post('/api/v1/workspaces/current/members/invite')
      .set(bearer(ADMIN_ID))
      .send({ email: 'invitee@example.com', role: 'MEMBER' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe('invitee@example.com');
    expect(res.body.data.token).toHaveLength(64);
    expect(storeInviteMock).toHaveBeenCalled();
    expect(prismaMock.auditLog.create).toHaveBeenCalled();
  });

  it('POST /workspaces/current/members/invite returns 409 when user is already a member', async () => {
    mockAdminRole();
    prismaMock.user.findUnique.mockResolvedValue({
      email: 'existing@example.com',
      workspaceMemberships: [{ workspaceId: WS_ID }],
    });

    const res = await request(app)
      .post('/api/v1/workspaces/current/members/invite')
      .set(bearer(ADMIN_ID))
      .send({ email: 'existing@example.com', role: 'MEMBER' })
      .expect(409);

    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('GET /workspaces/current/members/invites returns pending invites', async () => {
    mockAdminRole();
    listWorkspaceInvitesMock.mockResolvedValue([PENDING_INVITE]);

    const res = await request(app)
      .get('/api/v1/workspaces/current/members/invites')
      .set(bearer(ADMIN_ID))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].email).toBe('invitee@example.com');
  });

  it('DELETE /workspaces/current/members/invites/:token revokes invite', async () => {
    mockAdminRole();
    getInviteMock.mockResolvedValue(PENDING_INVITE);

    await request(app)
      .delete(`/api/v1/workspaces/current/members/invites/${INVITE_TOKEN}`)
      .set(bearer(ADMIN_ID))
      .expect(204);

    expect(deleteInviteMock).toHaveBeenCalledWith(WS_ID, INVITE_TOKEN);
    expect(prismaMock.auditLog.create).toHaveBeenCalled();
  });

  it('PATCH /workspaces/current/members/:userId updates member role', async () => {
    mockAdminRole();
    prismaMock.workspaceMember.findFirst.mockImplementation(async (args: { where?: { userId?: string } }) => {
      if (args?.where?.userId === ADMIN_ID) return { id: 'm-admin', role: 'ADMIN', userId: ADMIN_ID };
      if (args?.where?.userId === TARGET_ID) return { id: 'm-target', role: 'MEMBER', userId: TARGET_ID };
      return null;
    });
    prismaMock.workspaceMember.update.mockResolvedValue({
      id: 'm-target',
      role: 'VIEWER',
      userId: TARGET_ID,
      user: { id: TARGET_ID, name: 'Target', email: 'target@example.com' },
    });

    const res = await request(app)
      .patch(`/api/v1/workspaces/current/members/${TARGET_ID}`)
      .set(bearer(ADMIN_ID))
      .send({ role: 'VIEWER' })
      .expect(200);

    expect(res.body.data.role).toBe('VIEWER');
    expect(prismaMock.auditLog.create).toHaveBeenCalled();
  });

  it('DELETE /workspaces/current/members/:userId removes member', async () => {
    mockAdminRole();
    prismaMock.workspaceMember.findFirst.mockImplementation(async (args: { where?: { userId?: string } }) => {
      if (args?.where?.userId === ADMIN_ID) return { id: 'm-admin', role: 'ADMIN', userId: ADMIN_ID };
      if (args?.where?.userId === TARGET_ID) return { id: 'm-target', role: 'MEMBER', userId: TARGET_ID };
      return null;
    });
    prismaMock.workspaceMember.delete.mockResolvedValue({ id: 'm-target' });

    await request(app)
      .delete(`/api/v1/workspaces/current/members/${TARGET_ID}`)
      .set(bearer(ADMIN_ID))
      .expect(204);

    expect(prismaMock.workspaceMember.delete).toHaveBeenCalled();
    expect(prismaMock.auditLog.create).toHaveBeenCalled();
  });

  it('POST /workspaces/current/members/accept-invite adds member and switches workspace', async () => {
    getInviteMock.mockResolvedValue(PENDING_INVITE);
    prismaMock.workspaceMember.findFirst.mockImplementation(async (args: { where?: { userId?: string; workspaceId?: string } }) => {
      if (args?.where?.userId === MEMBER_ID && args?.where?.workspaceId === 'ws-other') {
        return { role: 'OWNER' };
      }
      return null;
    });
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({
      id: MEMBER_ID,
      email: 'invitee@example.com',
    });
    prismaMock.workspaceMember.create.mockResolvedValue({
      id: 'm-new',
      workspaceId: WS_ID,
      userId: MEMBER_ID,
      role: 'MEMBER',
      user: { id: MEMBER_ID, name: 'Invitee', email: 'invitee@example.com' },
    });

    const res = await request(app)
      .post('/api/v1/workspaces/current/members/accept-invite')
      .set(bearer(MEMBER_ID, 'ws-other', 'invitee@example.com'))
      .send({ token: INVITE_TOKEN })
      .expect(200);

    expect(res.body.data.member.user.email).toBe('invitee@example.com');
    expect(res.body.data.tokens.accessToken).toBe('new-access');
    expect(deleteInviteMock).toHaveBeenCalledWith(WS_ID, INVITE_TOKEN);
    expect(switchWorkspaceMock).toHaveBeenCalledWith(MEMBER_ID, WS_ID);
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app)
      .get('/api/v1/workspaces/current/members')
      .expect(401);

    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});
