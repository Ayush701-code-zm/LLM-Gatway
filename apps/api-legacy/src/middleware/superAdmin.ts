import type { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler';

/** Requires JWT with role SUPER_ADMIN (platform operator). */
export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    return next(AppError.unauthorized('Authentication required'));
  }
  if (req.user.role !== 'SUPER_ADMIN') {
    return next(AppError.forbidden('Super-admin access required'));
  }
  next();
}
