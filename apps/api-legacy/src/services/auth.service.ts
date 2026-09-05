import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '@smartroute/database';
import type { AuthTokens, AuthUser, LoginRequest, RegisterRequest } from '@smartroute/shared';
import type { LoginResult } from './mfa.service';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../middleware/errorHandler';
import { syncRateLimitRecord } from '../lib/syncRateLimit';
import { emailService } from './email.service';

const BCRYPT_ROUNDS = 12;

export class AuthService {
  async register(data: RegisterRequest): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw AppError.conflict('Email already in use');

    if (data.workspaceSlug) {
      const slugTaken = await prisma.workspace.findUnique({
        where: { slug: data.workspaceSlug },
        select: { id: true },
      });
      if (slugTaken) throw AppError.conflict('Workspace slug already taken');
    }

    const hashedPassword = await bcrypt.hash(data.password, BCRYPT_ROUNDS);

    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: data.email,
          name: data.name,
          hashedPassword,
        },
      });

      const workspaceName = data.workspaceName ?? `${data.name}'s Workspace`;
      const slug = data.workspaceSlug ?? this.generateSlug(workspaceName);

      const workspace = await tx.workspace.create({
        data: {
          name: workspaceName,
          slug,
          members: {
            create: {
              userId: newUser.id,
              role: 'OWNER',
            },
          },
          budgets: {
            create: {
              name: 'Default Budget',
              limitUsd: 50,
              period: 'MONTHLY',
              periodStartAt: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
              periodEndAt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
            },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: newUser.id,
          workspaceId: workspace.id,
          action: 'USER_CREATED',
          resourceType: 'user',
          resourceId: newUser.id,
          metadata: { email: newUser.email },
        },
      });

      return { newUser, workspace };
    });

    const tokens = await this.issueTokens(user.newUser.id, user.workspace.id, data.email);
    await syncRateLimitRecord(user.workspace.id);
    const authUser = await this.getAuthUser(user.newUser.id);

    await this.sendVerificationEmail(user.newUser.id).catch(() => {});

    return { user: authUser, tokens };
  }

  async login(data: LoginRequest, ipAddress?: string, userAgent?: string): Promise<LoginResult> {
    const user = await prisma.user.findUnique({
      where: { email: data.email },
      select: { id: true, email: true, hashedPassword: true, deletedAt: true, mfaEnabled: true },
    });

    if (!user || user.deletedAt) throw AppError.unauthorized('Invalid credentials');

    const valid = await bcrypt.compare(data.password, user.hashedPassword);
    if (!valid) throw AppError.unauthorized('Invalid credentials');

    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: user.id },
      orderBy: { joinedAt: 'asc' },
      select: { workspaceId: true },
    });

    if (!membership) throw AppError.internal('No workspace found for user');

    if (user.mfaEnabled) {
      const { mfaService } = await import('./mfa.service');
      return {
        mfaRequired: true,
        mfaToken: mfaService.createMfaChallenge(user.id, membership.workspaceId, user.email),
      };
    }

    return this.finalizeLogin(user.id, membership.workspaceId, user.email, ipAddress, {}, {
      ipAddress,
      userAgent,
    });
  }

  async finalizeLogin(
    userId: string,
    workspaceId: string,
    email: string,
    ipAddress?: string,
    metadata: Record<string, unknown> = {},
    sessionMeta?: { ipAddress?: string; userAgent?: string },
  ): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    await prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });

    await prisma.auditLog.create({
      data: {
        userId,
        action: 'USER_LOGIN',
        ipAddress,
        metadata: { email, ...metadata },
      },
    });

    const tokens = await this.issueTokens(userId, workspaceId, email, sessionMeta);
    const authUser = await this.getAuthUser(userId);
    return { user: authUser, tokens };
  }

  async listSessions(userId: string) {
    return prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        expiresAt: true,
        userAgent: true,
        ipAddress: true,
      },
    });
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await prisma.refreshToken.findFirst({
      where: { id: sessionId, userId, revokedAt: null },
    });
    if (!session) throw AppError.notFound('Session not found');
    await prisma.refreshToken.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
  }

  async revokeOtherSessions(userId: string, currentRefreshToken: string): Promise<number> {
    const result = await prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        token: { not: currentRefreshToken },
      },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  async refreshTokens(refreshToken: string): Promise<AuthTokens> {
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as jwt.JwtPayload;
    } catch {
      throw AppError.unauthorized('Invalid refresh token');
    }

    const stored = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      select: { id: true, userId: true, expiresAt: true, revokedAt: true },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw AppError.unauthorized('Refresh token expired or revoked');
    }

    // Rotate: revoke old, issue new
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: stored.userId },
      orderBy: { joinedAt: 'asc' },
      select: { workspaceId: true },
    });

    return this.issueTokens(stored.userId, membership?.workspaceId ?? '', payload.email as string);
  }

  async switchWorkspace(userId: string, workspaceId: string): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    const membership = await prisma.workspaceMember.findFirst({
      where: { userId, workspaceId },
    });
    if (!membership) throw AppError.forbidden('You are not a member of this workspace');

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });

    const tokens = await this.issueTokens(userId, workspaceId, user.email);
    const authUser = await this.getAuthUser(userId);
    return { user: authUser, tokens };
  }

  /** Always returns success to avoid email enumeration. */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      select: { id: true, email: true, name: true, deletedAt: true },
    });

    if (!user || user.deletedAt) return;

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const webBase = env.API_BASE_URL.replace(':3001', ':3000');
    const resetUrl = `${webBase}/reset-password?token=${rawToken}`;

    const sent = await emailService.sendPasswordReset(user.email, { name: user.name, resetUrl });
    if (!sent && env.NODE_ENV !== 'production') {
      logger.info({ email: user.email, resetUrl }, 'Password reset email skipped — reset URL (dev only)');
    }
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (newPassword.length < 8) {
      throw AppError.badRequest('Password must be at least 8 characters');
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const user = await prisma.user.findFirst({
      where: {
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: { gt: new Date() },
        deletedAt: null,
      },
    });

    if (!user) throw AppError.badRequest('Invalid or expired reset link');

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        hashedPassword,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
      },
    });

    await prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async createWorkspace(userId: string, name: string): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    const slug = this.generateSlug(name);

    const workspace = await prisma.$transaction(async (tx) => {
      const ws = await tx.workspace.create({
        data: {
          name,
          slug,
          members: {
            create: { userId, role: 'OWNER' },
          },
          budgets: {
            create: {
              name: 'Default Budget',
              limitUsd: 50,
              period: 'MONTHLY',
              periodStartAt: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
              periodEndAt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
            },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          workspaceId: ws.id,
          action: 'WORKSPACE_CREATED',
          resourceType: 'workspace',
          resourceId: ws.id,
          metadata: { name },
        },
      });

      return ws;
    });

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });

    const tokens = await this.issueTokens(userId, workspace.id, user.email);
    await syncRateLimitRecord(workspace.id);
    const authUser = await this.getAuthUser(userId);
    return { user: authUser, tokens };
  }

  async sendVerificationEmail(userId: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        emailVerified: true,
        deletedAt: true,
      },
    });

    if (!user || user.deletedAt || user.emailVerified) return;

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationTokenHash: tokenHash,
        emailVerificationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    const webBase = env.API_BASE_URL.replace(':3001', ':3000');
    const verifyUrl = `${webBase}/verify-email?token=${rawToken}`;

    const sent = await emailService.sendEmailVerification(user.email, { name: user.name, verifyUrl });
    if (!sent && env.NODE_ENV !== 'production') {
      logger.info({ email: user.email, verifyUrl }, 'Verification email skipped — verify URL (dev only)');
    }
  }

  async updateProfile(userId: string, name: string): Promise<AuthUser> {
    if (name.length < 2 || name.length > 100) {
      throw AppError.badRequest('Name must be 2–100 characters');
    }

    await prisma.user.update({
      where: { id: userId },
      data: { name },
    });

    return this.getAuthUser(userId);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    if (newPassword.length < 8) {
      throw AppError.badRequest('New password must be at least 8 characters');
    }

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { hashedPassword: true },
    });

    const valid = await bcrypt.compare(currentPassword, user.hashedPassword);
    if (!valid) throw AppError.unauthorized('Current password is incorrect');

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    await prisma.user.update({
      where: { id: userId },
      data: { hashedPassword },
    });

    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async verifyEmail(token: string): Promise<void> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const user = await prisma.user.findFirst({
      where: {
        emailVerificationTokenHash: tokenHash,
        emailVerificationExpiresAt: { gt: new Date() },
        deletedAt: null,
      },
    });

    if (!user) throw AppError.badRequest('Invalid or expired verification link');

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerificationTokenHash: null,
        emailVerificationExpiresAt: null,
      },
    });
  }

  async logout(refreshToken: string): Promise<void> {
    await prisma.refreshToken
      .updateMany({
        where: { token: refreshToken },
        data: { revokedAt: new Date() },
      })
      .catch(() => {});
  }

  private async issueTokens(
    userId: string,
    workspaceId: string,
    email: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<AuthTokens> {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { role: true },
    });

    const accessToken = jwt.sign(
      { sub: userId, workspaceId, email, role: user.role },
      env.JWT_SECRET,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { expiresIn: env.JWT_EXPIRES_IN as any },
    );

    const refreshTokenValue = uuidv4() + '-' + uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.refreshToken.create({
      data: {
        userId,
        token: refreshTokenValue,
        expiresAt,
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      },
    });

    return {
      accessToken,
      refreshToken: refreshTokenValue,
      expiresIn: 15 * 60,
    };
  }

  async loginOrRegisterOAuth(data: {
    email: string;
    name: string;
    avatarUrl?: string;
    provider: string;
    providerId: string;
  }): Promise<LoginResult> {
    let user = await prisma.user.findUnique({ where: { email: data.email } });

    if (!user) {
      const result = await this.register({
        name:          data.name,
        email:         data.email,
        password:      crypto.randomBytes(32).toString('hex'),
        workspaceName: `${data.name}'s Workspace`,
      });
      if (data.avatarUrl) {
        await prisma.user.update({
          where: { id: result.user.id },
          data:  { avatarUrl: data.avatarUrl, emailVerified: true },
        });
      }
      return result;
    }

    await prisma.user.update({
      where: { id: user.id },
      data:  {
        lastLoginAt: new Date(),
        ...(data.avatarUrl ? { avatarUrl: data.avatarUrl } : {}),
      },
    });

    const membership = await prisma.workspaceMember.findFirst({
      where:   { userId: user.id },
      orderBy: { joinedAt: 'asc' },
      select:  { workspaceId: true },
    });

    if (!membership) throw AppError.internal('No workspace found for user');

    const fullUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { id: true, email: true, mfaEnabled: true },
    });

    if (fullUser.mfaEnabled) {
      const { mfaService } = await import('./mfa.service');
      return {
        mfaRequired: true,
        mfaToken: mfaService.createMfaChallenge(fullUser.id, membership.workspaceId, fullUser.email),
      };
    }

    return this.finalizeLogin(user.id, membership.workspaceId, user.email);
  }

  /** JIT-provision or link user via SAML SSO into a specific workspace. */
  async loginOrRegisterSaml(params: {
    email: string;
    name: string;
    workspaceId: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<LoginResult> {
    const email = params.email.toLowerCase().trim();
    const { enforceMemberLimit } = await import('../lib/planEnforcement');

    let user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, deletedAt: true, mfaEnabled: true, name: true },
    });

    if (!user || user.deletedAt) {
      const hashedPassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), BCRYPT_ROUNDS);
      user = await prisma.user.create({
        data: {
          email,
          name: params.name || email.split('@')[0],
          hashedPassword,
          emailVerified: true,
          role: 'USER',
        },
        select: { id: true, email: true, deletedAt: true, mfaEnabled: true, name: true },
      });
    } else if (params.name && params.name !== user.name) {
      await prisma.user.update({ where: { id: user.id }, data: { name: params.name } });
    }

    let membership = await prisma.workspaceMember.findFirst({
      where: { userId: user.id, workspaceId: params.workspaceId },
    });

    if (!membership) {
      await enforceMemberLimit(params.workspaceId);
      membership = await prisma.workspaceMember.create({
        data: {
          userId: user.id,
          workspaceId: params.workspaceId,
          role: 'MEMBER',
        },
      });

      await prisma.auditLog.create({
        data: {
          workspaceId: params.workspaceId,
          userId: user.id,
          action: 'MEMBER_ADDED',
          resourceType: 'member',
          resourceId: membership.id,
          metadata: { via: 'saml' },
        },
      });
    }

    if (user.mfaEnabled) {
      const { mfaService } = await import('./mfa.service');
      return {
        mfaRequired: true,
        mfaToken: mfaService.createMfaChallenge(user.id, params.workspaceId, user.email),
      };
    }

    return this.finalizeLogin(
      user.id,
      params.workspaceId,
      user.email,
      params.ipAddress,
      { via: 'saml' },
      { ipAddress: params.ipAddress, userAgent: params.userAgent },
    );
  }

  async getAuthUser(userId: string): Promise<AuthUser> {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        role: true,
        emailVerified: true,
        mfaEnabled: true,
        workspaceMemberships: {
          select: {
            role: true,
            workspace: { select: { id: true, slug: true, name: true } },
          },
        },
      },
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      role: user.role,
      emailVerified: user.emailVerified,
      mfaEnabled: user.mfaEnabled,
      workspaces: user.workspaceMemberships.map((m: typeof user.workspaceMemberships[number]) => ({
        id: m.workspace.id,
        slug: m.workspace.slug,
        name: m.workspace.name,
        role: m.role,
      })),
    };
  }

  /** GDPR data portability — export profile, memberships, and active sessions. */
  async exportUserData(userId: string) {
    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        emailVerified: true,
        mfaEnabled: true,
        avatarUrl: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });

    if (!user) throw AppError.notFound('User not found');

    const memberships = await prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: { select: { id: true, slug: true, name: true, plan: true } } },
    });

    const sessions = await prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, createdAt: true, expiresAt: true, ipAddress: true, userAgent: true },
      orderBy: { createdAt: 'desc' },
    });

    return {
      exportedAt: new Date().toISOString(),
      user,
      workspaces: memberships.map((m) => ({
        id: m.workspace.id,
        slug: m.workspace.slug,
        name: m.workspace.name,
        plan: m.workspace.plan,
        role: m.role,
        joinedAt: m.joinedAt,
      })),
      sessions,
    };
  }

  /** Soft-delete account after password confirmation. */
  async deleteAccount(userId: string, password: string): Promise<void> {
    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { hashedPassword: true },
    });

    if (!user) throw AppError.notFound('User not found');

    const valid = await bcrypt.compare(password, user.hashedPassword);
    if (!valid) throw AppError.unauthorized('Password is incorrect');

    const owned = await prisma.workspaceMember.findMany({
      where: { userId, role: 'OWNER' },
      include: { workspace: { select: { id: true, name: true, deletedAt: true } } },
    });

    for (const membership of owned) {
      if (membership.workspace.deletedAt) continue;
      const otherMembers = await prisma.workspaceMember.count({
        where: { workspaceId: membership.workspaceId, userId: { not: userId } },
      });
      if (otherMembers > 0) {
        throw AppError.conflict(
          `Transfer ownership of "${membership.workspace.name}" before deleting your account`,
        );
      }
    }

    const randomPassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), BCRYPT_ROUNDS);

    await prisma.$transaction(async (tx) => {
      for (const membership of owned) {
        if (membership.workspace.deletedAt) continue;
        await tx.workspace.update({
          where: { id: membership.workspaceId },
          data: { deletedAt: new Date(), isActive: false },
        });
      }

      await tx.workspaceMember.deleteMany({ where: { userId } });

      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await tx.user.update({
        where: { id: userId },
        data: {
          deletedAt: new Date(),
          email: `deleted-${userId}@removed.local`,
          name: 'Deleted User',
          avatarUrl: null,
          mfaEnabled: false,
          mfaSecretEncrypted: null,
          mfaBackupCodesHash: null,
          hashedPassword: randomPassword,
          emailVerificationTokenHash: null,
          emailVerificationExpiresAt: null,
          passwordResetTokenHash: null,
          passwordResetExpiresAt: null,
        },
      });
    });
  }

  private generateSlug(name: string): string {
    return (
      name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 40) +
      '-' +
      Math.random().toString(36).slice(2, 6)
    );
  }
}

export const authService = new AuthService();
