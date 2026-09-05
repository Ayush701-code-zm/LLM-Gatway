import { describe, it, expect, vi, beforeEach } from 'vitest';

// Singleton mock Redis — getRedis() must return the SAME object every time
const redisMock = {
  get: vi.fn(),
  set: vi.fn().mockResolvedValue('OK'),
};

vi.mock('../../config/redis', () => ({
  getRedis: () => redisMock,
}));

vi.mock('@smartroute/database', () => ({
  prisma: {
    circuitBreakerEvent: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock('../../config/metrics', () => ({
  circuitBreakerState:  { set: vi.fn() },
  register:             { contentType: 'text/plain', metrics: vi.fn() },
  httpRequestDuration:  { startTimer: vi.fn().mockReturnValue(vi.fn()) },
  llmRequestDuration:   { observe: vi.fn() },
  llmRequestsTotal:     { inc: vi.fn() },
  llmCostUsd:           { inc: vi.fn() },
  llmSavingsUsd:        { inc: vi.fn() },
  cacheHitsTotal:       { inc: vi.fn() },
  cacheMissesTotal:     { inc: vi.fn() },
  cacheHitRate:         { set: vi.fn() },
  rateLimitedRequestsTotal: { inc: vi.fn() },
  fallbackEventsTotal:  { inc: vi.fn() },
  providerAvailability: { set: vi.fn() },
  queueDepth:           { set: vi.fn() },
  activeConnections:    { set: vi.fn() },
  collectDefaultMetrics: vi.fn(),
}));

import { CircuitBreakerEngine } from '../../engines/circuitBreaker';

const FAILURE_THRESHOLD = 5;
const SUCCESS_THRESHOLD = 2;

describe('CircuitBreakerEngine', () => {
  let cb: CircuitBreakerEngine;
  const provider = 'OPENAI';
  const model    = 'gpt-4o';
  const cbKey    = `cb:${provider}:${model}`;

  function mockRedisGet(state: object | null) {
    redisMock.get.mockResolvedValueOnce(state ? JSON.stringify(state) : null);
  }

  function lastSetPayload(): Record<string, unknown> {
    const calls = redisMock.set.mock.calls;
    return JSON.parse(calls[calls.length - 1][1] as string);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    redisMock.set.mockResolvedValue('OK');
    cb = new CircuitBreakerEngine();
  });

  // ── isOpen ───────────────────────────────────────────────────
  describe('isOpen()', () => {
    it('returns false (CLOSED) when no state in Redis', async () => {
      mockRedisGet(null);
      expect(await cb.isOpen(provider, model)).toBe(false);
      expect(redisMock.get).toHaveBeenCalledWith(cbKey);
    });

    it('returns false for CLOSED state', async () => {
      mockRedisGet({ state: 'CLOSED', failureCount: 0, successCount: 0 });
      expect(await cb.isOpen(provider, model)).toBe(false);
    });

    it('returns true for OPEN state within timeout (nextAttemptAt in the future)', async () => {
      mockRedisGet({
        state:         'OPEN',
        failureCount:  5,
        successCount:  0,
        nextAttemptAt: new Date(Date.now() + 50_000).toISOString(),
      });
      expect(await cb.isOpen(provider, model)).toBe(true);
    });

    it('transitions OPEN → HALF_OPEN when timeout has elapsed', async () => {
      mockRedisGet({
        state:         'OPEN',
        failureCount:  5,
        successCount:  0,
        nextAttemptAt: new Date(Date.now() - 70_000).toISOString(), // 70s past timeout
      });
      const open = await cb.isOpen(provider, model);
      expect(open).toBe(false); // HALF_OPEN allows probe
      const saved = lastSetPayload();
      expect(saved.state).toBe('HALF_OPEN');
    });

    it('returns false for HALF_OPEN (allows probe request)', async () => {
      mockRedisGet({ state: 'HALF_OPEN', failureCount: 5, successCount: 0 });
      expect(await cb.isOpen(provider, model)).toBe(false);
    });
  });

  // ── recordSuccess ─────────────────────────────────────────────
  describe('recordSuccess()', () => {
    it('resets failure count when CLOSED', async () => {
      mockRedisGet({ state: 'CLOSED', failureCount: 3, successCount: 1 });
      await cb.recordSuccess(provider, model);
      const saved = lastSetPayload();
      expect(saved.failureCount).toBe(0);
      expect(saved.state).toBe('CLOSED');
    });

    it('stays HALF_OPEN after first success (SUCCESS_THRESHOLD = 2)', async () => {
      mockRedisGet({ state: 'HALF_OPEN', failureCount: 5, successCount: 0 });
      await cb.recordSuccess(provider, model);
      const saved = lastSetPayload();
      expect(saved.state).toBe('HALF_OPEN');
      expect(saved.successCount).toBe(1);
    });

    it('closes circuit after SUCCESS_THRESHOLD successes in HALF_OPEN', async () => {
      // successCount is already at threshold-1 = 1; next success closes it
      mockRedisGet({ state: 'HALF_OPEN', failureCount: 5, successCount: SUCCESS_THRESHOLD - 1 });
      await cb.recordSuccess(provider, model);
      const saved = lastSetPayload();
      expect(saved.state).toBe('CLOSED');
      expect(saved.failureCount).toBe(0);
    });

    it('does not throw when Redis.get fails', async () => {
      redisMock.get.mockRejectedValueOnce(new Error('Redis down'));
      await expect(cb.recordSuccess(provider, model)).resolves.not.toThrow();
    });
  });

  // ── recordFailure ─────────────────────────────────────────────
  describe('recordFailure()', () => {
    it('increments failure count when below threshold', async () => {
      mockRedisGet({ state: 'CLOSED', failureCount: 2, successCount: 0 });
      await cb.recordFailure(provider, model);
      const saved = lastSetPayload();
      expect(saved.failureCount).toBe(3);
      expect(saved.state).toBe('CLOSED');
    });

    it('opens circuit when FAILURE_THRESHOLD is reached', async () => {
      mockRedisGet({ state: 'CLOSED', failureCount: FAILURE_THRESHOLD - 1, successCount: 0 });
      await cb.recordFailure(provider, model);
      const saved = lastSetPayload();
      expect(saved.state).toBe('OPEN');
      expect(saved.failureCount).toBe(FAILURE_THRESHOLD);
      expect(saved.nextAttemptAt).toBeTruthy();
    });

    it('immediately opens from HALF_OPEN on any failure', async () => {
      mockRedisGet({ state: 'HALF_OPEN', failureCount: 5, successCount: 1 });
      await cb.recordFailure(provider, model);
      const saved = lastSetPayload();
      expect(saved.state).toBe('OPEN');
    });

    it('uses correct key format', async () => {
      mockRedisGet(null);
      await cb.recordFailure('ANTHROPIC', 'claude-haiku-3-5');
      expect(redisMock.get).toHaveBeenCalledWith('cb:ANTHROPIC:claude-haiku-3-5');
    });

    it('does not throw when Redis.get fails', async () => {
      redisMock.get.mockRejectedValueOnce(new Error('Redis down'));
      await expect(cb.recordFailure(provider, model)).resolves.not.toThrow();
    });
  });
});
