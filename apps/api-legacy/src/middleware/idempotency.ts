/**
 * Idempotency-Key middleware for POST /chat.
 *
 * If the client sends an `Idempotency-Key` header:
 *   1. Check Redis for a cached response under that key.
 *   2. If found: return the cached response immediately (no LLM call, no charge).
 *   3. If not found: let the request proceed, then cache the response.
 *
 * Key format in Redis:  idem:{workspaceId}:{idempotencyKey}
 * TTL: 24 hours (RFC-7231 recommendation for idempotency window).
 *
 * Why this matters:
 *   - Prevents double-charging when clients retry due to timeouts or network errors.
 *   - Safe to retry any failed chat request with the same Idempotency-Key.
 *   - The stored response includes the original requestId for traceability.
 */

import type { Request, Response, NextFunction } from 'express';
import { getRedis } from '../config/redis';
import { logger } from '../config/logger';

const IDEMPOTENCY_PREFIX = 'idem:';
const IDEMPOTENCY_TTL_SECONDS = 86_400; // 24 hours
const MAX_KEY_LENGTH = 255;

export function idempotencyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const rawKey = req.headers['idempotency-key'] as string | undefined;
  if (!rawKey) {
    next();
    return;
  }

  if (rawKey.length > MAX_KEY_LENGTH) {
    res.status(400).json({
      success: false,
      error: {
        code:    'INVALID_IDEMPOTENCY_KEY',
        message: `Idempotency-Key must be ≤ ${MAX_KEY_LENGTH} characters`,
      },
    });
    return;
  }

  const workspaceId = req.apiKey?.workspaceId;
  if (!workspaceId) {
    // No workspace context yet — skip idempotency (auth middleware runs first)
    next();
    return;
  }

  const redisKey = `${IDEMPOTENCY_PREFIX}${workspaceId}:${rawKey}`;
  const redis    = getRedis();

  redis.get(redisKey).then((cached) => {
    if (cached) {
      logger.debug({ workspaceId, idempotencyKey: rawKey }, 'Idempotency cache hit — returning stored response');

      const parsed = JSON.parse(cached) as { status: number; body: unknown; requestId: string };
      res.setHeader('X-Idempotent-Replayed', 'true');
      res.setHeader('X-Request-ID', parsed.requestId);
      res.status(parsed.status).json(parsed.body);
      return;
    }

    // Not cached — intercept the response to cache it
    const originalJson = res.json.bind(res);
    res.json = function (body: unknown) {
      // Only cache successful responses (2xx)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const payload = JSON.stringify({
          status:    res.statusCode,
          body,
          requestId: req.requestId,
        });
        redis.set(redisKey, payload, 'EX', IDEMPOTENCY_TTL_SECONDS).catch(() => {});
        logger.debug({ workspaceId, idempotencyKey: rawKey }, 'Idempotency response cached');
      }
      return originalJson(body);
    };

    next();
  }).catch((err) => {
    // Redis failure — fail open (process request normally, just skip idempotency)
    logger.warn({ err, workspaceId, idempotencyKey: rawKey }, 'Idempotency Redis read failed — proceeding without idempotency');
    next();
  });
}
