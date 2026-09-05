/**
 * Backpressure Middleware
 *
 * Rejects new requests when global in-flight LLM call count exceeds threshold.
 * Protects the gateway from overload during traffic spikes.
 */

import type { Request, Response, NextFunction } from 'express';
import { getRedis } from '../config/redis';
import { env } from '../config/env';
import { AppError } from './errorHandler';
import { logger } from '../config/logger';

const INFLIGHT_KEY = 'gateway:inflight';
const MAX_INFLIGHT = env.MAX_INFLIGHT_REQUESTS;

export async function backpressureMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const redis = getRedis();
    const current = await redis.incr(INFLIGHT_KEY);

    if (current === 1) {
      await redis.expire(INFLIGHT_KEY, 300);
    }

    if (current > MAX_INFLIGHT) {
      await redis.decr(INFLIGHT_KEY);
      logger.warn({ current, max: MAX_INFLIGHT, requestId: req.requestId }, 'Backpressure: rejecting request');
      res.setHeader('Retry-After', '5');
      return next(new AppError(503, 'BACKPRESSURE', 'Gateway is at capacity. Retry shortly.'));
    }

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      redis.decr(INFLIGHT_KEY).catch(() => {});
    };

    res.on('finish', release);
    res.on('close', release);

    next();
  } catch (err) {
    logger.error({ err }, 'Backpressure check failed — failing open');
    next();
  }
}
