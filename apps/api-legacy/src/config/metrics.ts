import client from 'prom-client';

const register = client.register;

// Enable default Node.js metrics (event loop lag, GC, heap, etc.)
client.collectDefaultMetrics({
  register,
  prefix: 'smartroute_node_',
});

// ===========================================================
// Custom metrics
// ===========================================================

export const httpRequestDuration = new client.Histogram({
  name: 'smartroute_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const llmRequestDuration = new client.Histogram({
  name: 'smartroute_llm_request_duration_seconds',
  help: 'Duration of LLM provider requests in seconds',
  labelNames: ['provider', 'model', 'status'],
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [register],
});

export const llmRequestsTotal = new client.Counter({
  name: 'smartroute_llm_requests_total',
  help: 'Total number of LLM requests',
  labelNames: ['provider', 'model', 'status', 'workspace_id'],
  registers: [register],
});

export const llmCostUsd = new client.Counter({
  name: 'smartroute_llm_cost_usd_total',
  help: 'Total LLM cost in USD',
  labelNames: ['provider', 'model', 'workspace_id'],
  registers: [register],
});

export const llmSavingsUsd = new client.Counter({
  name: 'smartroute_llm_savings_usd_total',
  help: 'Total LLM savings in USD',
  labelNames: ['type', 'workspace_id'],
  registers: [register],
});

export const cacheHitRate = new client.Gauge({
  name: 'smartroute_cache_hit_rate',
  help: 'Semantic cache hit rate (rolling window)',
  labelNames: ['workspace_id'],
  registers: [register],
});

export const cacheHitsTotal = new client.Counter({
  name: 'smartroute_cache_hits_total',
  help: 'Total cache hits',
  labelNames: ['workspace_id'],
  registers: [register],
});

export const cacheMissesTotal = new client.Counter({
  name: 'smartroute_cache_misses_total',
  help: 'Total cache misses',
  labelNames: ['workspace_id'],
  registers: [register],
});

export const rateLimitedRequestsTotal = new client.Counter({
  name: 'smartroute_rate_limited_requests_total',
  help: 'Total number of rate-limited requests',
  labelNames: ['workspace_id', 'reason'],
  registers: [register],
});

export const fallbackEventsTotal = new client.Counter({
  name: 'smartroute_fallback_events_total',
  help: 'Total fallback events',
  labelNames: ['from_provider', 'to_provider'],
  registers: [register],
});

export const circuitBreakerState = new client.Gauge({
  name: 'smartroute_circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=open, 2=half-open)',
  labelNames: ['provider', 'model'],
  registers: [register],
});

export const providerAvailability = new client.Gauge({
  name: 'smartroute_provider_availability',
  help: 'Provider availability (1=available, 0=unavailable)',
  labelNames: ['provider', 'model'],
  registers: [register],
});

export const activeConnections = new client.Gauge({
  name: 'smartroute_active_connections',
  help: 'Number of active connections',
  registers: [register],
});

export const queueDepth = new client.Gauge({
  name: 'smartroute_queue_depth',
  help: 'Number of jobs in queues',
  labelNames: ['queue_name'],
  registers: [register],
});

export { register };
