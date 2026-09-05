"""Domain-level Prometheus metrics helpers."""

from __future__ import annotations

from smartroute.config.metrics import (
    cache_hits_total,
    cache_misses_total,
    cache_hit_rate,
    circuit_breaker_state,
    fallback_events_total,
    llm_cost_usd,
    llm_request_duration,
    llm_requests_total,
    llm_savings_usd,
    provider_availability,
    queue_depth,
    rate_limited_requests_total,
)


class GatewayMetrics:
    def record_request(
        self,
        *,
        provider: str,
        model: str,
        workspace_id: str,
        status: str,
        latency_ms: int,
        actual_cost_usd: float,
        baseline_cost_usd: float,
        cache_hit: bool,
    ) -> None:
        llm_request_duration.labels(provider=provider, model=model, status=status).observe(
            latency_ms / 1000
        )
        llm_requests_total.labels(
            provider=provider,
            model=model,
            status=status,
            workspace_id=workspace_id,
        ).inc()

        if actual_cost_usd > 0:
            llm_cost_usd.labels(
                provider=provider,
                model=model,
                workspace_id=workspace_id,
            ).inc(actual_cost_usd)

        savings = baseline_cost_usd - actual_cost_usd
        if savings > 0:
            llm_savings_usd.labels(
                type="cache" if cache_hit else "routing",
                workspace_id=workspace_id,
            ).inc(savings)

        if cache_hit:
            cache_hits_total.labels(workspace_id=workspace_id).inc()
        else:
            cache_misses_total.labels(workspace_id=workspace_id).inc()

    def update_cache_hit_rate(self, workspace_id: str, hit_rate_pct: float) -> None:
        cache_hit_rate.labels(workspace_id=workspace_id).set(hit_rate_pct / 100)

    def record_rate_limited(self, workspace_id: str, reason: str) -> None:
        rate_limited_requests_total.labels(workspace_id=workspace_id, reason=reason).inc()

    def update_circuit_breaker(self, provider: str, model: str, state: str) -> None:
        state_val = 0 if state == "CLOSED" else 1 if state == "OPEN" else 2
        circuit_breaker_state.labels(provider=provider, model=model).set(state_val)

    def update_provider_health(self, provider: str, model: str, available: bool) -> None:
        provider_availability.labels(provider=provider, model=model).set(1 if available else 0)

    def record_fallback(self, from_provider: str, to_provider: str) -> None:
        fallback_events_total.labels(from_provider=from_provider, to_provider=to_provider).inc()

    def update_queue_depth(self, queue_name: str, depth: int) -> None:
        queue_depth.labels(queue_name=queue_name).set(depth)


gateway_metrics = GatewayMetrics()
