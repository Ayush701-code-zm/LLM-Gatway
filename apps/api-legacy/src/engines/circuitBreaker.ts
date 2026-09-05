import { getRedis } from '../config/redis';
import { prisma } from '@smartroute/database';
import { CIRCUIT_BREAKER } from '@smartroute/shared';
import { logger } from '../config/logger';
import { circuitBreakerState } from '../config/metrics';
import type { CircuitState, CircuitBreakerStatus } from '../types';

const REDIS_PREFIX = 'cb:';

function key(provider: string, model: string): string {
  return `${REDIS_PREFIX}${provider}:${model}`;
}

/**
 * Redis-backed circuit breaker.
 *
 * State machine:
 *   CLOSED  → failures ≥ threshold → OPEN
 *   OPEN    → timeout elapsed      → HALF_OPEN
 *   HALF_OPEN → success            → CLOSED
 *   HALF_OPEN → failure            → OPEN
 */
export class CircuitBreakerEngine {
  async getStatus(provider: string, model: string): Promise<CircuitBreakerStatus> {
    try {
      const redis = getRedis();
      const raw = await redis.get(key(provider, model));
      if (!raw) return { state: 'CLOSED', failureCount: 0, successCount: 0 };
      return JSON.parse(raw) as CircuitBreakerStatus;
    } catch (e: unknown) {
      logger.warn({ err: e, provider, model }, 'Circuit breaker Redis read failed — assuming CLOSED');
      return { state: 'CLOSED', failureCount: 0, successCount: 0 };
    }
  }

  async isOpen(provider: string, model: string): Promise<boolean> {
    const status = await this.getStatus(provider, model);

    if (status.state === 'CLOSED') return false;

    if (status.state === 'OPEN') {
      const now = Date.now();
      if (status.nextAttemptAt && new Date(status.nextAttemptAt).getTime() <= now) {
        // Transition to HALF_OPEN
        await this.setState(provider, model, 'HALF_OPEN', status);
        return false;
      }
      return true;
    }

    // HALF_OPEN: allow a probe request
    return false;
  }

  async recordSuccess(provider: string, model: string): Promise<void> {
    const status = await this.getStatus(provider, model);

    if (status.state === 'HALF_OPEN') {
      const newSuccessCount = status.successCount + 1;
      if (newSuccessCount >= CIRCUIT_BREAKER.SUCCESS_THRESHOLD) {
        await this.close(provider, model, status);
      } else {
        await this.setState(provider, model, 'HALF_OPEN', {
          ...status,
          successCount: newSuccessCount,
        });
      }
    } else if (status.state === 'CLOSED') {
      // Reset failure count on success
      await this.setState(provider, model, 'CLOSED', {
        ...status,
        failureCount: 0,
        successCount: status.successCount + 1,
      });
    }

    circuitBreakerState.set({ provider, model }, 0);
  }

  async recordFailure(provider: string, model: string): Promise<void> {
    const status = await this.getStatus(provider, model);
    const newFailureCount = status.failureCount + 1;

    if (
      status.state === 'HALF_OPEN' ||
      newFailureCount >= CIRCUIT_BREAKER.FAILURE_THRESHOLD
    ) {
      await this.open(provider, model, status, newFailureCount);
    } else {
      await this.setState(provider, model, 'CLOSED', {
        ...status,
        failureCount: newFailureCount,
        lastFailureAt: new Date(),
      });
    }
  }

  private async open(
    provider: string,
    model: string,
    current: CircuitBreakerStatus,
    failureCount: number,
  ): Promise<void> {
    const nextAttemptAt = new Date(Date.now() + CIRCUIT_BREAKER.TIMEOUT_MS);

    await this.setState(provider, model, 'OPEN', {
      ...current,
      failureCount,
      lastFailureAt: new Date(),
      nextAttemptAt,
    });

    logger.warn({ provider, model, failureCount }, 'Circuit breaker OPENED');
    circuitBreakerState.set({ provider, model }, 1);

    // Persist event
    await prisma.circuitBreakerEvent.create({
      data: {
        provider: provider as never,
        modelId: model,
        fromState: current.state === 'HALF_OPEN' ? 'HALF_OPEN' : 'CLOSED',
        toState: 'OPEN',
        reason: `${failureCount} consecutive failures`,
        failureCount,
      },
    }).catch((e: unknown) => logger.error({ err: e }, 'Failed to persist circuit breaker event'));
  }

  private async close(
    provider: string,
    model: string,
    current: CircuitBreakerStatus,
  ): Promise<void> {
    await this.setState(provider, model, 'CLOSED', {
      state: 'CLOSED',
      failureCount: 0,
      successCount: 0,
    });

    logger.info({ provider, model }, 'Circuit breaker CLOSED (recovered)');
    circuitBreakerState.set({ provider, model }, 0);

    await prisma.circuitBreakerEvent.create({
      data: {
        provider: provider as never,
        modelId: model,
        fromState: 'HALF_OPEN',
        toState: 'CLOSED',
        reason: 'Sufficient successful probe requests',
        failureCount: current.failureCount,
        successCount: current.successCount,
        resolvedAt: new Date(),
      },
    }).catch((e: unknown) => logger.error({ err: e }, 'Failed to persist circuit breaker event'));
  }

  private async setState(
    provider: string,
    model: string,
    state: CircuitState,
    data: Partial<CircuitBreakerStatus>,
  ): Promise<void> {
    const redis = getRedis();
    const payload: CircuitBreakerStatus = {
      state,
      failureCount: data.failureCount ?? 0,
      successCount: data.successCount ?? 0,
      lastFailureAt: data.lastFailureAt,
      nextAttemptAt: data.nextAttemptAt,
    };
    // TTL slightly longer than the open timeout so Redis doesn't evict active entries
    await redis.set(key(provider, model), JSON.stringify(payload), 'EX', 300);
  }
}

export const circuitBreaker = new CircuitBreakerEngine();
