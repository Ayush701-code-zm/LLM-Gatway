"""Prometheus metrics."""

from __future__ import annotations

from prometheus_client import Counter, Gauge, Histogram

llm_request_duration = Histogram(
    "smartroute_llm_request_duration_seconds",
    "Duration of LLM provider requests in seconds",
    labelnames=["provider", "model", "status"],
    buckets=[0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
)

llm_requests_total = Counter(
    "smartroute_llm_requests_total",
    "Total number of LLM requests",
    labelnames=["provider", "model", "status", "workspace_id"],
)

llm_cost_usd = Counter(
    "smartroute_llm_cost_usd_total",
    "Total LLM cost in USD",
    labelnames=["provider", "model", "workspace_id"],
)

llm_savings_usd = Counter(
    "smartroute_llm_savings_usd_total",
    "Total LLM savings in USD",
    labelnames=["type", "workspace_id"],
)

cache_hit_rate = Gauge(
    "smartroute_cache_hit_rate",
    "Semantic cache hit rate (rolling window)",
    labelnames=["workspace_id"],
)

cache_hits_total = Counter(
    "smartroute_cache_hits_total",
    "Total cache hits",
    labelnames=["workspace_id"],
)

cache_misses_total = Counter(
    "smartroute_cache_misses_total",
    "Total cache misses",
    labelnames=["workspace_id"],
)

rate_limited_requests_total = Counter(
    "smartroute_rate_limited_requests_total",
    "Total number of rate-limited requests",
    labelnames=["workspace_id", "reason"],
)

fallback_events_total = Counter(
    "smartroute_fallback_events_total",
    "Total fallback events",
    labelnames=["from_provider", "to_provider"],
)

circuit_breaker_state = Gauge(
    "smartroute_circuit_breaker_state",
    "Circuit breaker state (0=closed, 1=open, 2=half-open)",
    labelnames=["provider", "model"],
)

provider_availability = Gauge(
    "smartroute_provider_availability",
    "Provider availability (1=available, 0=unavailable)",
    labelnames=["provider", "model"],
)

queue_depth = Gauge(
    "smartroute_queue_depth",
    "Number of jobs in queues",
    labelnames=["queue_name"],
)

coalesced_requests_total = Counter(
    "smartroute_coalesced_requests_total",
    "Number of LLM requests served from an identical in-flight coalesced request",
    labelnames=["workspace_id"],
)

injection_attempts_total = Counter(
    "smartroute_injection_attempts_total",
    "Number of detected prompt injection attempts",
    labelnames=["severity", "workspace_id"],
)

anomalies_detected_total = Counter(
    "smartroute_anomalies_detected_total",
    "Number of anomalies detected across all workspaces",
    labelnames=["workspace_id", "anomaly_type"],
)
