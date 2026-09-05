import type { Request } from 'express';
import { AppError } from '../middleware/errorHandler';

/** JWT payload uses `sub` for user id and `workspaceId` for active workspace. */
export function getAuthUserId(req: Request): string {
  const userId = req.user?.sub;
  if (!userId) throw AppError.unauthorized('Authentication required');
  return userId;
}

export function getAuthWorkspaceId(req: Request): string {
  const workspaceId = req.user?.workspaceId;
  if (!workspaceId) throw AppError.badRequest('No active workspace in token');
  return workspaceId;
}
