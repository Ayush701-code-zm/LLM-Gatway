import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock factory is hoisted — must use vi.fn() directly, not module-level variables
vi.mock('../../config/metrics', () => ({
  register:                 { contentType: 'text/plain', metrics: vi.fn() },
  httpRequestDuration:      { startTimer: vi.fn().mockReturnValue(vi.fn()), observe: vi.fn() },
  llmRequestDuration:       { observe: vi.fn() },
  llmRequestsTotal:         { inc: vi.fn() },
  llmCostUsd:               { inc: vi.fn() },
  llmSavingsUsd:            { inc: vi.fn() },
  cacheHitsTotal:           { inc: vi.fn() },
  cacheMissesTotal:         { inc: vi.fn() },
  cacheHitRate:             { set: vi.fn() },
  rateLimitedRequestsTotal: { inc: vi.fn() },
  fallbackEventsTotal:      { inc: vi.fn() },
  circuitBreakerState:      { set: vi.fn() },
  providerAvailability:     { set: vi.fn() },
  queueDepth:               { set: vi.fn() },
  activeConnections:        { set: vi.fn() },
  collectDefaultMetrics:    vi.fn(),
}));

import { gatewayMetrics }      from '../../lib/gatewayMetrics';
import * as metricsModule      from '../../config/metrics';

describe('gatewayMetrics', () => {
  beforeEach(() => vi.clearAllMocks());

  const baseRequest = {
    provider:        'GOOGLE',
    model:           'gemini-1.5-flash',
    workspaceId:     'ws-123',
    status:          'success' as const,
    latencyMs:       350,
    actualCostUsd:   0.00005,
    baselineCostUsd: 0.00150,
    cacheHit:        false,
  };

  describe('recordRequest()', () => {
    it('observes llmRequestDuration with latency in seconds', () => {
      gatewayMetrics.recordRequest(baseRequest);
      expect(metricsModule.llmRequestDuration.observe).toHaveBeenCalledWith(
        { provider: 'GOOGLE', model: 'gemini-1.5-flash', status: 'success' },
        350 / 1000,
      );
    });

    it('increments llmRequestsTotal with correct labels', () => {
      gatewayMetrics.recordRequest(baseRequest);
      expect(metricsModule.llmRequestsTotal.inc).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'GOOGLE', model: 'gemini-1.5-flash' }),
      );
    });

    it('increments llmCostUsd with actual cost value', () => {
      gatewayMetrics.recordRequest(baseRequest);
      expect(metricsModule.llmCostUsd.inc).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'GOOGLE', workspace_id: 'ws-123' }),
        0.00005,
      );
    });

    it('increments llmSavingsUsd with savings value', () => {
      gatewayMetrics.recordRequest(baseRequest);
      const savings = 0.00150 - 0.00005;
      expect(metricsModule.llmSavingsUsd.inc).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'routing', workspace_id: 'ws-123' }),
        expect.closeTo(savings, 8),
      );
    });

    it('increments cacheMissesTotal on cache miss', () => {
      gatewayMetrics.recordRequest({ ...baseRequest, cacheHit: false });
      expect(metricsModule.cacheMissesTotal.inc).toHaveBeenCalledWith({ workspace_id: 'ws-123' });
    });

    it('increments cacheHitsTotal on cache hit', () => {
      gatewayMetrics.recordRequest({ ...baseRequest, cacheHit: true });
      expect(metricsModule.cacheHitsTotal.inc).toHaveBeenCalledWith({ workspace_id: 'ws-123' });
    });

    it('does NOT increment cost for zero-cost requests (cache hits)', () => {
      gatewayMetrics.recordRequest({ ...baseRequest, actualCostUsd: 0 });
      expect(metricsModule.llmCostUsd.inc).not.toHaveBeenCalled();
    });

    it('labels cache hits with type=cache in savings', () => {
      gatewayMetrics.recordRequest({ ...baseRequest, cacheHit: true, actualCostUsd: 0, baselineCostUsd: 0.001 });
      expect(metricsModule.llmSavingsUsd.inc).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'cache' }),
        expect.any(Number),
      );
    });
  });

  describe('updateCircuitBreaker()', () => {
    it('maps CLOSED → 0', () => {
      gatewayMetrics.updateCircuitBreaker('OPENAI', 'gpt-4o', 'CLOSED');
      expect(metricsModule.circuitBreakerState.set).toHaveBeenCalledWith(
        { provider: 'OPENAI', model: 'gpt-4o' }, 0,
      );
    });

    it('maps OPEN → 1', () => {
      gatewayMetrics.updateCircuitBreaker('OPENAI', 'gpt-4o', 'OPEN');
      expect(metricsModule.circuitBreakerState.set).toHaveBeenCalledWith(
        { provider: 'OPENAI', model: 'gpt-4o' }, 1,
      );
    });

    it('maps HALF_OPEN → 2', () => {
      gatewayMetrics.updateCircuitBreaker('ANTHROPIC', 'claude-haiku-3-5', 'HALF_OPEN');
      expect(metricsModule.circuitBreakerState.set).toHaveBeenCalledWith(
        { provider: 'ANTHROPIC', model: 'claude-haiku-3-5' }, 2,
      );
    });
  });

  describe('updateProviderHealth()', () => {
    it('sets 1 for available provider', () => {
      gatewayMetrics.updateProviderHealth('GOOGLE', 'gemini-1.5-pro', true);
      expect(metricsModule.providerAvailability.set).toHaveBeenCalledWith(
        { provider: 'GOOGLE', model: 'gemini-1.5-pro' }, 1,
      );
    });

    it('sets 0 for unavailable provider', () => {
      gatewayMetrics.updateProviderHealth('GOOGLE', 'gemini-1.5-pro', false);
      expect(metricsModule.providerAvailability.set).toHaveBeenCalledWith(
        { provider: 'GOOGLE', model: 'gemini-1.5-pro' }, 0,
      );
    });
  });

  describe('updateCacheHitRate()', () => {
    it('converts percent to 0–1 range', () => {
      gatewayMetrics.updateCacheHitRate('ws-abc', 75.5);
      expect(metricsModule.cacheHitRate.set).toHaveBeenCalledWith(
        { workspace_id: 'ws-abc' }, 0.755,
      );
    });

    it('handles 0% correctly', () => {
      gatewayMetrics.updateCacheHitRate('ws-abc', 0);
      expect(metricsModule.cacheHitRate.set).toHaveBeenCalledWith({ workspace_id: 'ws-abc' }, 0);
    });

    it('handles 100% correctly', () => {
      gatewayMetrics.updateCacheHitRate('ws-abc', 100);
      expect(metricsModule.cacheHitRate.set).toHaveBeenCalledWith({ workspace_id: 'ws-abc' }, 1);
    });
  });

  describe('recordFallback()', () => {
    it('increments fallback events counter', () => {
      gatewayMetrics.recordFallback('OPENAI', 'ANTHROPIC');
      expect(metricsModule.fallbackEventsTotal.inc).toHaveBeenCalledWith({
        from_provider: 'OPENAI',
        to_provider:   'ANTHROPIC',
      });
    });
  });

  describe('updateQueueDepth()', () => {
    it('sets queue depth gauge', () => {
      gatewayMetrics.updateQueueDepth('analytics', 42);
      expect(metricsModule.queueDepth.set).toHaveBeenCalledWith({ queue_name: 'analytics' }, 42);
    });
  });
});
