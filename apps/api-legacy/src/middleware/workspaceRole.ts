import type { Request, Response, NextFunction } from 'express';
import { prisma } from '@smartroute/database';
import { AppError } from './errorHandler';
import { getAuthUserId, getAuthWorkspaceId } from '../lib/workspaceContext';

type WorkspaceRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

declare global {
  namespace Express {
    interface Request {
      workspaceRole?: WorkspaceRole;
    }
  }
}

/** Loads workspace member role onto req.workspaceRole. */
export async function loadWorkspaceRole(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = getAuthUserId(req);
    const workspaceId = getAuthWorkspaceId(req);

    const membership = await prisma.workspaceMember.findFirst({
      where:  { userId, workspaceId },
      select: { role: true },
    });

    if (!membership) {
      return next(AppError.forbidden('You are not a member of this workspace'));
    }

    req.workspaceRole = membership.role;
    next();
  } catch (err) {
    next(err);
  }
}

/** Requires one of the given workspace roles (must run after requireAuth + loadWorkspaceRole). */
export function requireWorkspaceRole(...roles: WorkspaceRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.workspaceRole) {
      return next(AppError.forbidden('Workspace role not loaded'));
    }
    if (!roles.includes(req.workspaceRole)) {
      return next(AppError.forbidden(`Requires one of: ${roles.join(', ')}`));
    }
    next();
  };
}

/** VIEWER can read; MEMBER+ can write most resources; ADMIN/OWNER for destructive ops. */
export const canWrite  = requireWorkspaceRole('OWNER', 'ADMIN', 'MEMBER');
export const canAdmin  = requireWorkspaceRole('OWNER', 'ADMIN');
export const canOwner  = requireWorkspaceRole('OWNER');
