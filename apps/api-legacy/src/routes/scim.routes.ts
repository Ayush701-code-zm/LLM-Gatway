/**
 * SCIM 2.0 provisioning (Enterprise preview).
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { prisma } from '@smartroute/database';
import { requireAuth } from '../middleware/auth';
import { loadWorkspaceRole, canAdmin } from '../middleware/workspaceRole';
import { validate } from '../middleware/validate';
import { AppError } from '../middleware/errorHandler';
import { getAuthWorkspaceId } from '../lib/workspaceContext';
import { env } from '../config/env';
import { generateScimToken, requireScimAuth, toScimUser } from '../lib/scim';
import { enforceMemberLimit } from '../lib/planEnforcement';

export const scimWorkspaceRouter = Router();

const PatchScimSchema = z.object({
  enabled: z.boolean().optional(),
  regenerateToken: z.boolean().optional(),
});

async function requireEnterprise(workspaceId: string) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      id: true,
      plan: true,
      scimEnabled: true,
      scimTokenPrefix: true,
      scimTokenHash: true,
    },
  });
  if (!ws) throw AppError.notFound('Workspace not found');
  if (ws.plan !== 'ENTERPRISE') throw AppError.forbidden('SCIM is available on the Enterprise plan only');
  return ws;
}

scimWorkspaceRouter.get(
  '/current/scim',
  requireAuth,
  loadWorkspaceRole,
  canAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ws = await requireEnterprise(getAuthWorkspaceId(req));
      const baseUrl = `${env.API_BASE_URL.replace(/\/$/, '')}/scim/v2`;
      res.status(200).json({
        success: true,
        data: {
          enabled: ws.scimEnabled,
          tokenPrefix: ws.scimTokenPrefix,
          baseUrl,
          hasToken: Boolean(ws.scimTokenHash),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

scimWorkspaceRouter.patch(
  '/current/scim',
  requireAuth,
  loadWorkspaceRole,
  canAdmin,
  validate(PatchScimSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = getAuthWorkspaceId(req);
      await requireEnterprise(workspaceId);

      const { enabled, regenerateToken } = req.body as z.infer<typeof PatchScimSchema>;
      let tokenPayload: { raw?: string; hash?: string; prefix?: string } = {};

      if (regenerateToken || (enabled && !(await requireEnterprise(workspaceId)).scimTokenHash)) {
        const generated = generateScimToken();
        tokenPayload = { raw: generated.raw, hash: generated.hash, prefix: generated.prefix };
      }

      const updated = await prisma.workspace.update({
        where: { id: workspaceId },
        data: {
          ...(enabled !== undefined ? { scimEnabled: enabled } : {}),
          ...(tokenPayload.hash
            ? { scimTokenHash: tokenPayload.hash, scimTokenPrefix: tokenPayload.prefix }
            : {}),
        },
        select: { scimEnabled: true, scimTokenPrefix: true, scimTokenHash: true },
      });

      await prisma.auditLog.create({
        data: {
          workspaceId,
          userId: req.user!.sub,
          action: 'SETTINGS_UPDATED',
          resourceType: 'scim',
          metadata: { enabled: updated.scimEnabled, tokenRotated: Boolean(regenerateToken) },
        },
      });

      const baseUrl = `${env.API_BASE_URL.replace(/\/$/, '')}/scim/v2`;
      res.status(200).json({
        success: true,
        data: {
          enabled: updated.scimEnabled,
          tokenPrefix: updated.scimTokenPrefix,
          baseUrl,
          hasToken: Boolean(updated.scimTokenHash),
          ...(tokenPayload.raw ? { token: tokenPayload.raw } : {}),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ── SCIM 2.0 API ──────────────────────────────────────────────

export const scimRouter = Router();

scimRouter.use(requireScimAuth);

scimRouter.get('/ServiceProviderConfig', (_req, res) => {
  res.status(200).json({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    patch: { supported: true },
    bulk: { supported: false },
    filter: { supported: false },
    authenticationSchemes: [{ type: 'oauthbearertoken', name: 'Bearer Token' }],
  });
});

scimRouter.get('/Users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.scimWorkspaceId!;
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, email: true, name: true, deletedAt: true } } },
    });

    res.status(200).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: members.length,
      Resources: members.map(toScimUser),
    });
  } catch (err) {
    next(err);
  }
});

scimRouter.post('/Users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.scimWorkspaceId!;
    const userName = (req.body.userName as string | undefined)?.toLowerCase().trim();
    const email = (req.body.emails?.[0]?.value as string | undefined)?.toLowerCase().trim() ?? userName;
    const name = (req.body.name?.formatted as string | undefined) ?? email?.split('@')[0] ?? 'User';

    if (!email) throw AppError.badRequest('userName or emails[0].value is required');

    let user = await prisma.user.findUnique({ where: { email } });

    if (!user || user.deletedAt) {
      const hashedPassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
      user = await prisma.user.create({
        data: { email, name, hashedPassword, emailVerified: true, role: 'USER' },
      });
    }

    const existing = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId: user.id },
      include: { user: { select: { id: true, email: true, name: true, deletedAt: true } } },
    });

    if (existing) {
      res.status(200).json(toScimUser(existing));
      return;
    }

    await enforceMemberLimit(workspaceId);
    const member = await prisma.workspaceMember.create({
      data: { workspaceId, userId: user.id, role: 'MEMBER' },
      include: { user: { select: { id: true, email: true, name: true, deletedAt: true } } },
    });

    await prisma.auditLog.create({
      data: {
        workspaceId,
        userId: user.id,
        action: 'MEMBER_ADDED',
        resourceType: 'member',
        resourceId: member.id,
        metadata: { via: 'scim' },
      },
    });

    res.status(201).json(toScimUser(member));
  } catch (err) {
    next(err);
  }
});

scimRouter.patch('/Users/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.scimWorkspaceId!;
    const userId = String(req.params.id);
    const active = req.body.active as boolean | undefined;

    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId },
      include: { user: { select: { id: true, email: true, name: true, deletedAt: true } } },
    });

    if (!member) throw AppError.notFound('User not found');

    if (active === false) {
      await prisma.workspaceMember.delete({ where: { id: member.id } });
      await prisma.auditLog.create({
        data: {
          workspaceId,
          userId,
          action: 'MEMBER_REMOVED',
          resourceType: 'member',
          resourceId: member.id,
          metadata: { via: 'scim' },
        },
      });
      res.status(200).json({ ...toScimUser(member), active: false });
      return;
    }

    res.status(200).json(toScimUser(member));
  } catch (err) {
    next(err);
  }
});

scimRouter.get('/Users/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.scimWorkspaceId!;
    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId: String(req.params.id) },
      include: { user: { select: { id: true, email: true, name: true, deletedAt: true } } },
    });

    if (!member) throw AppError.notFound('User not found');
    res.status(200).json(toScimUser(member));
  } catch (err) {
    next(err);
  }
});
