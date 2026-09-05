import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from '@smartroute/database';
import { AppError } from './errorHandler';
import type { AuthPayload } from '../types';
import { createHash } from 'crypto';

/**
 * Verifies Bearer JWT token. Attaches decoded payload to req.user.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return next(AppError.unauthorized('Missing or malformed Authorization header'));
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as AuthPayload;
    req.user = payload;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      next(new AppError(401, 'TOKEN_EXPIRED', 'Access token has expired'));
    } else {
      next(AppError.unauthorized('Invalid access token'));
    }
  }
}

/**
 * Authenticates via API key in X-API-Key header or Authorization: Bearer sk-...
 * Populates req.apiKey context for gateway routes.
 */
export async function requireApiKey(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const rawKey =
      (req.headers['x-api-key'] as string) ||
      (req.headers.authorization?.startsWith('Bearer sk-')
        ? req.headers.authorization.slice(7)
        : undefined);

    if (!rawKey) {
      return next(AppError.unauthorized('API key required. Provide X-API-Key header.'));
    }

    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    const apiKey = await prisma.apiKey.findUnique({
      where: { keyHash },
      select: {
        id: true,
        workspaceId: true,
        status: true,
        expiresAt: true,
        scopes: true,
        rateLimitRpm: true,
        rateLimitTpm: true,
      },
    });

    if (!apiKey || apiKey.status !== 'ACTIVE') {
      return next(new AppError(401, 'INVALID_API_KEY', 'Invalid or revoked API key'));
    }

    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      return next(new AppError(401, 'INVALID_API_KEY', 'API key has expired'));
    }

    // Non-blocking update of last used metadata
    prisma.apiKey
      .update({
        where: { id: apiKey.id },
        data: {
          lastUsedAt: new Date(),
          lastUsedIp: req.ip,
          requestCount: { increment: 1 },
        },
      })
      .catch(() => {});

    req.apiKey = {
      id: apiKey.id,
      workspaceId: apiKey.workspaceId,
      scopes: apiKey.scopes,
    };

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Requires a specific workspace role.
 */
export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(AppError.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(AppError.forbidden('Insufficient permissions'));
    }
    next();
  };
}
