/**
 * Member management routes (workspace-scoped).
 *
 * GET    /workspaces/current/members
 * POST   /workspaces/current/members/invite
 * PATCH  /workspaces/current/members/:userId
 * DELETE /workspaces/current/members/:userId
 * POST   /workspaces/current/members/:userId/transfer-ownership
 * POST   /workspaces/current/members/leave
 * POST   /workspaces/current/members/accept-invite  (public with token)
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { prisma } from '@smartroute/database';
import { requireAuth } from '../middleware/auth';
import { requireEmailVerified } from '../middleware/emailVerified';
import { validate } from '../middleware/validate';
import { loadWorkspaceRole, canAdmin, canOwner } from '../middleware/workspaceRole';
import { getAuthUserId, getAuthWorkspaceId } from '../lib/workspaceContext';
import { enforceMemberLimit } from '../lib/planEnforcement';
import { emailService } from '../services/email.service';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';
import { deleteInvite, getInvite, listWorkspaceInvites, storeInvite } from '../lib/invites';
import { assertOwnerCanLeave } from '../lib/memberLifecycle';
import { authService } from '../services/auth.service';

export const memberRouter = Router();

const InviteSchema = z.object({
  email: z.string().email(),
  role:  z.enum(['ADMIN', 'MEMBER', 'VIEWER']).default('MEMBER'),
});

const PatchMemberSchema = z.object({
  role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']),
});

const AcceptInviteSchema = z.object({
  token: z.string().min(32),
});

memberRouter.use(requireAuth);

memberRouter.get('/current/members', loadWorkspaceRole, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = getAuthWorkspaceId(req);
    const members = await prisma.workspaceMember.findMany({
      where:   { workspaceId },
      include: { user: { select: { id: true, name: true, email: true, avatarUrl: true, lastLoginAt: true } } },
      orderBy: { joinedAt: 'asc' },
    });
    res.status(200).json({ success: true, data: members });
  } catch (err) {
    next(err);
  }
});

memberRouter.post(
  '/current/members/invite',
  loadWorkspaceRole,
  canAdmin,
  requireEmailVerified,
  validate(InviteSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = getAuthWorkspaceId(req);
      const userId = getAuthUserId(req);
      const { email, role } = req.body as z.infer<typeof InviteSchema>;

      await enforceMemberLimit(workspaceId);

      const existingMember = await prisma.user.findUnique({
        where: { email },
        include: { workspaceMemberships: { where: { workspaceId } } },
      });

      if (existingMember?.workspaceMemberships.length) {
        throw AppError.conflict('User is already a workspace member');
      }

      const workspace = await prisma.workspace.findUniqueOrThrow({
        where:  { id: workspaceId },
        select: { name: true },
      });

      const inviter = await prisma.user.findUniqueOrThrow({
        where:  { id: userId },
        select: { name: true },
      });

      const token = crypto.randomBytes(32).toString('hex');
      const invitedAt = new Date().toISOString();

      await storeInvite(workspaceId, token, {
        email,
        role,
        invitedBy: userId,
        invitedAt,
      });

      const acceptUrl = `${env.API_BASE_URL.replace(':3001', ':3000')}/accept-invite?token=${token}`;

      const sent = await emailService.sendMemberInvite(email, {
        workspaceName: workspace.name,
        inviterName:   inviter.name,
        role,
        acceptUrl,
      });

      if (!sent && env.NODE_ENV !== 'production') {
        const { logger } = await import('../config/logger');
        logger.info({ email, acceptUrl }, 'Invite email skipped — accept URL (dev only)');
      }

      await prisma.auditLog.create({
        data: {
          workspaceId,
          userId,
          action:       'MEMBER_ADDED',
          resourceType: 'invite',
          metadata:     { email, role, pending: true },
        },
      });

      res.status(201).json({
        success: true,
        data: { email, role, acceptUrl, expiresInDays: 7, token },
      });
    } catch (err) {
      next(err);
    }
  },
);

memberRouter.get(
  '/current/members/invites',
  loadWorkspaceRole,
  canAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = getAuthWorkspaceId(req);
      const invites = await listWorkspaceInvites(workspaceId);
      res.status(200).json({ success: true, data: invites });
    } catch (err) {
      next(err);
    }
  },
);

memberRouter.delete(
  '/current/members/invites/:token',
  loadWorkspaceRole,
  canAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = getAuthWorkspaceId(req);
      const token = String(req.params.token);
      const invite = await getInvite(token);

      if (!invite) throw AppError.notFound('Invite not found or expired');
      if (invite.workspaceId !== workspaceId) {
        throw AppError.forbidden('Invite belongs to another workspace');
      }

      await deleteInvite(workspaceId, token);

      await prisma.auditLog.create({
        data: {
          workspaceId,
          userId: getAuthUserId(req),
          action: 'MEMBER_REMOVED',
          resourceType: 'invite',
          metadata: { email: invite.email, revoked: true },
        },
      });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

memberRouter.post(
  '/current/members/accept-invite',
  validate(AcceptInviteSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getAuthUserId(req);
      const { token } = req.body as z.infer<typeof AcceptInviteSchema>;

      const invite = await getInvite(token);
      if (!invite) throw AppError.notFound('Invite not found or expired');

      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.email !== invite.email) {
        throw AppError.forbidden('Invite email does not match your account');
      }

      await enforceMemberLimit(invite.workspaceId);

      const member = await prisma.workspaceMember.create({
        data: {
          workspaceId: invite.workspaceId,
          userId,
          role:        invite.role,
          invitedBy:   invite.invitedBy,
        },
        include: { user: { select: { id: true, name: true, email: true } } },
      });

      await deleteInvite(invite.workspaceId, token);

      await prisma.auditLog.create({
        data: {
          workspaceId: invite.workspaceId,
          userId,
          action:       'MEMBER_ADDED',
          resourceType: 'member',
          resourceId:   member.id,
          metadata:     { via: 'invite' },
        },
      });

      const { authService } = await import('../services/auth.service');
      const switched = await authService.switchWorkspace(userId, invite.workspaceId);

      res.status(200).json({
        success: true,
        data: {
          member,
          workspaceId: invite.workspaceId,
          user: switched.user,
          tokens: switched.tokens,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

memberRouter.patch(
  '/current/members/:userId',
  loadWorkspaceRole,
  canAdmin,
  validate(PatchMemberSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = getAuthWorkspaceId(req);
      const targetUserId = String(req.params.userId);
      const { role } = req.body as z.infer<typeof PatchMemberSchema>;

      const member = await prisma.workspaceMember.findFirst({
        where: { workspaceId, userId: targetUserId },
      });
      if (!member) throw AppError.notFound('Member not found');
      if (member.role === 'OWNER') {
        throw AppError.forbidden('Cannot change the owner role here — use transfer ownership');
      }

      const updated = await prisma.workspaceMember.update({
        where: { id: member.id },
        data:  { role },
        include: { user: { select: { id: true, name: true, email: true } } },
      });

      await prisma.auditLog.create({
        data: {
          workspaceId,
          userId: getAuthUserId(req),
          action:       'MEMBER_ROLE_CHANGED',
          resourceType: 'member',
          resourceId:   member.id,
          metadata:     { newRole: role, previousRole: member.role },
        },
      });

      res.status(200).json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
);

memberRouter.post(
  '/current/members/:userId/transfer-ownership',
  loadWorkspaceRole,
  canOwner,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = getAuthWorkspaceId(req);
      const actorId = getAuthUserId(req);
      const targetUserId = String(req.params.userId);

      if (targetUserId === actorId) {
        throw AppError.badRequest('Cannot transfer ownership to yourself');
      }

      const [ownerMembership, targetMembership] = await Promise.all([
        prisma.workspaceMember.findFirst({ where: { workspaceId, userId: actorId } }),
        prisma.workspaceMember.findFirst({
          where: { workspaceId, userId: targetUserId },
          include: { user: { select: { id: true, name: true, email: true } } },
        }),
      ]);

      if (!ownerMembership || ownerMembership.role !== 'OWNER') {
        throw AppError.forbidden('Only the workspace owner can transfer ownership');
      }
      if (!targetMembership) throw AppError.notFound('Member not found');

      const [updatedOwner, updatedTarget] = await prisma.$transaction([
        prisma.workspaceMember.update({
          where: { id: ownerMembership.id },
          data: { role: 'ADMIN' },
          include: { user: { select: { id: true, name: true, email: true } } },
        }),
        prisma.workspaceMember.update({
          where: { id: targetMembership.id },
          data: { role: 'OWNER' },
          include: { user: { select: { id: true, name: true, email: true } } },
        }),
      ]);

      await prisma.auditLog.create({
        data: {
          workspaceId,
          userId: actorId,
          action: 'MEMBER_ROLE_CHANGED',
          resourceType: 'member',
          resourceId: targetMembership.id,
          metadata: {
            transfer: true,
            newOwnerId: targetUserId,
            previousOwnerId: actorId,
          },
        },
      });

      res.status(200).json({
        success: true,
        data: {
          previousOwner: updatedOwner,
          newOwner: updatedTarget,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

memberRouter.post(
  '/current/members/leave',
  loadWorkspaceRole,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = getAuthWorkspaceId(req);
      const userId = getAuthUserId(req);

      const membership = await prisma.workspaceMember.findFirst({
        where: { workspaceId, userId },
      });
      if (!membership) throw AppError.notFound('You are not a member of this workspace');

      const workspace = await prisma.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { name: true, deletedAt: true },
      });

      if (membership.role === 'OWNER') {
        const otherMembers = await prisma.workspaceMember.count({
          where: { workspaceId, userId: { not: userId } },
        });
        assertOwnerCanLeave(otherMembers, workspace.name);

        await prisma.$transaction([
          prisma.workspace.update({
            where: { id: workspaceId },
            data: { deletedAt: new Date(), isActive: false },
          }),
          prisma.workspaceMember.deleteMany({ where: { workspaceId } }),
        ]);
      } else {
        await prisma.workspaceMember.delete({ where: { id: membership.id } });
        await prisma.auditLog.create({
          data: {
            workspaceId,
            userId,
            action: 'MEMBER_REMOVED',
            resourceType: 'member',
            resourceId: membership.id,
            metadata: { self: true },
          },
        });
      }

      const nextMembership = await prisma.workspaceMember.findFirst({
        where: { userId },
        orderBy: { joinedAt: 'asc' },
        select: { workspaceId: true },
      });

      if (nextMembership) {
        const switched = await authService.switchWorkspace(userId, nextMembership.workspaceId);
        res.status(200).json({
          success: true,
          data: {
            left: true,
            workspaceDeactivated: membership.role === 'OWNER',
            user: switched.user,
            tokens: switched.tokens,
          },
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          left: true,
          workspaceDeactivated: membership.role === 'OWNER',
          noWorkspacesRemaining: true,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

memberRouter.delete(
  '/current/members/:userId',
  loadWorkspaceRole,
  canAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = getAuthWorkspaceId(req);
      const targetUserId = String(req.params.userId);
      const actorId = getAuthUserId(req);

      if (targetUserId === actorId) {
        throw AppError.badRequest('Cannot remove yourself');
      }

      const member = await prisma.workspaceMember.findFirst({
        where: { workspaceId, userId: targetUserId },
      });
      if (!member) throw AppError.notFound('Member not found');

      if (member.role === 'OWNER') {
        throw AppError.forbidden('Cannot remove workspace owner');
      }

      await prisma.workspaceMember.delete({ where: { id: member.id } });

      await prisma.auditLog.create({
        data: {
          workspaceId,
          userId: actorId,
          action:       'MEMBER_REMOVED',
          resourceType: 'member',
          resourceId:   member.id,
        },
      });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);
