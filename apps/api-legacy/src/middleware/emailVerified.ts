import type { Request, Response, NextFunction } from 'express';
import { prisma } from '@smartroute/database';
import { env } from '../config/env';
import { AppError } from './errorHandler';

/**
 * When REQUIRE_EMAIL_VERIFICATION=true, blocks unverified users from sensitive actions.
 * Default off for local development.
 */
export async function requireEmailVerified(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  if (!env.REQUIRE_EMAIL_VERIFICATION) {
    return next();
  }

  if (!req.user?.sub) {
    return next(AppError.unauthorized('Authentication required'));
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.sub },
    select: { emailVerified: true, deletedAt: true },
  });

  if (!user || user.deletedAt) {
    return next(AppError.unauthorized('Invalid user'));
  }

  if (!user.emailVerified) {
    return next(
      new AppError(
        403,
        'EMAIL_NOT_VERIFIED',
        'Verify your email before using this feature. Check your inbox or resend from the dashboard.',
      ),
    );
  }

  next();
}
