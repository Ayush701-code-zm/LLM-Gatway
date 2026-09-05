import { getRedis } from '../config/redis';
import { prisma } from '@smartroute/database';
import { PLAN_LIMITS } from '@smartroute/shared';
import { AppError } from '../middleware/errorHandler';
import { rateLimitedRequestsTotal } from '../config/metrics';
import { logger } from '../config/logger';

const REDIS_PREFIX = 'rl:';

export interface RateLimitInfo {
  /** Maximum requests allowed per minute */
  limitRpm:    number;
  /** Maximum requests allowed per day */
  limitRpd:    number;
  /** Current requests used in this minute window */
  usedRpm:     number;
  /** Current requests used today */
  usedRpd:     number;
  /** Remaining requests this minute */
  remainingRpm: number;
  /** Remaining requests today */
  remainingRpd: number;
  /** Unix timestamp (seconds) when the minute window resets */
  resetRpm:    number;
  /** Unix timestamp (seconds) when the day window resets */
  resetRpd:    number;
}

/**
 * Redis sliding-window rate limiter.
 *
 * Returns RateLimitInfo so callers can attach X-RateLimit-* response headers.
 * Throws AppError(429) when any limit is exceeded before modifying state.
 */
export class RateLimiterEngine {
  async check(workspaceId: string): Promise<RateLimitInfo> {
    const redis = getRedis();

    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { plan: true, requestsPerMinute: true, requestsPerDay: true },
    });

    const planLimits = PLAN_LIMITS[workspace.plan as keyof typeof PLAN_LIMITS];
    const rpm = workspace.requestsPerMinute ?? planLimits.requestsPerMinute;
    const rpd = workspace.requestsPerDay    ?? planLimits.requestsPerDay;

    const now = Date.now();
    const minuteWindow = Math.floor(now / 60_000);
    const dayWindow    = Math.floor(now / 86_400_000);

    const rpmKey = `${REDIS_PREFIX}rpm:${workspaceId}:${minuteWindow}`;
    const rpdKey = `${REDIS_PREFIX}rpd:${workspaceId}:${dayWindow}`;

    const pipeline = redis.pipeline();
    pipeline.incr(rpmKey);
    pipeline.expire(rpmKey, 120);
    pipeline.incr(rpdKey);
    pipeline.expire(rpdKey, 172800);

    const results = await pipeline.exec();
    if (!results) throw AppError.internal('Rate limiter pipeline failed');

    const currentRpm = results[0][1] as number;
    const currentRpd = results[2][1] as number;

    // Reset timestamps
    const resetRpm = (minuteWindow + 1) * 60;
    const resetRpd = (dayWindow    + 1) * 86400;

    if (currentRpm > rpm) {
      rateLimitedRequestsTotal.inc({ workspace_id: workspaceId, reason: 'rpm' });
      logger.warn({ workspaceId, currentRpm, limit: rpm }, 'Rate limit exceeded (RPM)');
      throw AppError.rateLimitExceeded(resetRpm - Math.floor(now / 1000));
    }

    if (currentRpd > rpd) {
      rateLimitedRequestsTotal.inc({ workspace_id: workspaceId, reason: 'rpd' });
      logger.warn({ workspaceId, currentRpd, limit: rpd }, 'Rate limit exceeded (RPD)');
      throw AppError.rateLimitExceeded(resetRpd - Math.floor(now / 1000));
    }

    return {
      limitRpm:     rpm,
      limitRpd:     rpd,
      usedRpm:      currentRpm,
      usedRpd:      currentRpd,
      remainingRpm: Math.max(0, rpm - currentRpm),
      remainingRpd: Math.max(0, rpd - currentRpd),
      resetRpm,
      resetRpd,
    };
  }

  /** Read current consumption without incrementing counters (for dashboard display). */
  async getStatus(workspaceId: string): Promise<
    RateLimitInfo & { limitTpm: number; usedTpm: number; remainingTpm: number }
  > {
    const redis = getRedis();

    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { plan: true, requestsPerMinute: true, requestsPerDay: true, tokensPerMinute: true },
    });

    const planLimits = PLAN_LIMITS[workspace.plan as keyof typeof PLAN_LIMITS];
    const rpm = workspace.requestsPerMinute ?? planLimits.requestsPerMinute;
    const rpd = workspace.requestsPerDay ?? planLimits.requestsPerDay;
    const tpm = workspace.tokensPerMinute ?? planLimits.tokensPerMinute;

    const now = Date.now();
    const minuteWindow = Math.floor(now / 60_000);
    const dayWindow = Math.floor(now / 86_400_000);

    const rpmKey = `${REDIS_PREFIX}rpm:${workspaceId}:${minuteWindow}`;
    const rpdKey = `${REDIS_PREFIX}rpd:${workspaceId}:${dayWindow}`;
    const tpmKey = `${REDIS_PREFIX}tpm:${workspaceId}:${minuteWindow}`;

    const [rpmRaw, rpdRaw, tpmRaw] = await Promise.all([
      redis.get(rpmKey),
      redis.get(rpdKey),
      redis.get(tpmKey),
    ]);

    const usedRpm = parseInt(rpmRaw ?? '0', 10);
    const usedRpd = parseInt(rpdRaw ?? '0', 10);
    const usedTpm = parseInt(tpmRaw ?? '0', 10);

    const resetRpm = (minuteWindow + 1) * 60;
    const resetRpd = (dayWindow + 1) * 86400;

    return {
      limitRpm: rpm,
      limitRpd: rpd,
      usedRpm,
      usedRpd,
      remainingRpm: Math.max(0, rpm - usedRpm),
      remainingRpd: Math.max(0, rpd - usedRpd),
      resetRpm,
      resetRpd,
      limitTpm: tpm,
      usedTpm,
      remainingTpm: Math.max(0, tpm - usedTpm),
    };
  }

  async checkTokens(workspaceId: string, estimatedTokens: number): Promise<void> {
    const redis = getRedis();

    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { plan: true, tokensPerMinute: true },
    });

    const planLimits = PLAN_LIMITS[workspace.plan as keyof typeof PLAN_LIMITS];
    const tpm = workspace.tokensPerMinute ?? planLimits.tokensPerMinute;

    const now = Date.now();
    const minuteWindow = Math.floor(now / 60_000);
    const tpmKey = `${REDIS_PREFIX}tpm:${workspaceId}:${minuteWindow}`;

    const pipeline = redis.pipeline();
    pipeline.incrby(tpmKey, estimatedTokens);
    pipeline.expire(tpmKey, 120);

    const results = await pipeline.exec();
    if (!results) return;

    const currentTpm = results[0][1] as number;
    if (currentTpm > tpm) {
      rateLimitedRequestsTotal.inc({ workspace_id: workspaceId, reason: 'tpm' });
      throw new AppError(429, 'TOKEN_LIMIT_EXCEEDED', 'Token per minute limit exceeded', {
        retryAfter: 60,
      });
    }
  }
}

export const rateLimiterEngine = new RateLimiterEngine();
