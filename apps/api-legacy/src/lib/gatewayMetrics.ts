/**
 * Domain-level Prometheus metrics helpers.
 *
 * Called from the gateway service, routing engine, and BullMQ workers
 * to record business-level observability data.
 */

import {
  llmRequestDuration,
  llmRequestsTotal,
  llmCostUsd,
  llmSavingsUsd,
  cacheHitsTotal,
  cacheMissesTotal,
  cacheHitRate,
  rateLimitedRequestsTotal,
  fallbackEventsTotal,
  circuitBreakerState,
  providerAvailability,
  queueDepth,
} from '../config/metrics';

export const gatewayMetrics = {
  // ── LLM request recording ─────────────────────────────────────
  recordRequest({
    provider,
    model,
    workspaceId,
    status,
    latencyMs,
    actualCostUsd,
    baselineCostUsd,
    cacheHit,
  }: {
    provider: string;
    model: string;
    workspaceId: string;
    status: 'success' | 'error' | 'fallback' | 'cached';
    latencyMs: number;
    actualCostUsd: number;
    baselineCostUsd: number;
    cacheHit: boolean;
  }) {
    llmRequestDuration.observe(
      { provider, model, status },
      latencyMs / 1000,
    );

    llmRequestsTotal.inc({ provider, model, status, workspace_id: workspaceId });

    if (actualCostUsd > 0) {
      llmCostUsd.inc({ provider, model, workspace_id: workspaceId }, actualCostUsd);
    }

    const savings = baselineCostUsd - actualCostUsd;
    if (savings > 0) {
      llmSavingsUsd.inc(
        { type: cacheHit ? 'cache' : 'routing', workspace_id: workspaceId },
        savings,
      );
    }

    if (cacheHit) {
      cacheHitsTotal.inc({ workspace_id: workspaceId });
    } else {
      cacheMissesTotal.inc({ workspace_id: workspaceId });
    }
  },

  // ── Cache hit-rate gauge (rolling window approximation) ───────
  updateCacheHitRate(workspaceId: string, hitRatePct: number) {
    cacheHitRate.set({ workspace_id: workspaceId }, hitRatePct / 100);
  },

  // ── Rate limiting ─────────────────────────────────────────────
  recordRateLimited(workspaceId: string, reason: 'rpm' | 'tpm' | 'rpd') {
    rateLimitedRequestsTotal.inc({ workspace_id: workspaceId, reason });
  },

  // ── Circuit breaker ───────────────────────────────────────────
  updateCircuitBreaker(provider: string, model: string, state: 'CLOSED' | 'OPEN' | 'HALF_OPEN') {
    const stateVal = state === 'CLOSED' ? 0 : state === 'OPEN' ? 1 : 2;
    circuitBreakerState.set({ provider, model }, stateVal);
  },

  // ── Provider health ───────────────────────────────────────────
  updateProviderHealth(provider: string, model: string, available: boolean) {
    providerAvailability.set({ provider, model }, available ? 1 : 0);
  },

  // ── Fallback events ───────────────────────────────────────────
  recordFallback(fromProvider: string, toProvider: string) {
    fallbackEventsTotal.inc({ from_provider: fromProvider, to_provider: toProvider });
  },

  // ── Queue depth ───────────────────────────────────────────────
  updateQueueDepth(queueName: string, depth: number) {
    queueDepth.set({ queue_name: queueName }, depth);
  },
};
