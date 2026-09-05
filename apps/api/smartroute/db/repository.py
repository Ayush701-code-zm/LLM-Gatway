"""Async database repository for gateway operations."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smartroute.types.gateway import ModelRegistryRow, WorkspaceRoutingConfig


def _row_to_model(row: Any) -> ModelRegistryRow:
    return ModelRegistryRow(
        id=str(row.id),
        provider=str(row.provider),
        model_id=str(row.model_id),
        display_name=str(row.display_name),
        description=row.description,
        input_cost_per_million=float(row.input_cost_per_million),
        output_cost_per_million=float(row.output_cost_per_million),
        context_window=int(row.context_window),
        max_output_tokens=int(row.max_output_tokens),
        supports_streaming=bool(row.supports_streaming),
        supports_vision=bool(row.supports_vision),
        supports_functions=bool(row.supports_functions),
        supports_embeddings=bool(row.supports_embeddings),
        quality_tier=str(row.quality_tier),
        complexity_min_level=str(row.complexity_min_level),
        availability_status=str(row.availability_status),
        avg_latency_ms=float(row.avg_latency_ms) if row.avg_latency_ms is not None else None,
        p95_latency_ms=float(row.p95_latency_ms) if row.p95_latency_ms is not None else None,
        success_rate=float(row.success_rate) if row.success_rate is not None else None,
        is_enabled=bool(row.is_enabled),
        updated_at=row.updated_at,
    )


class GatewayRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_workspace_routing_config(self, workspace_id: str) -> WorkspaceRoutingConfig:
        result = await self.session.execute(
            text(
                """
                SELECT default_routing_strategy, allowed_providers,
                       semantic_cache_enabled, cache_threshold
                FROM workspaces
                WHERE id = :workspace_id
                """
            ),
            {"workspace_id": workspace_id},
        )
        row = result.one()
        return WorkspaceRoutingConfig(
            default_routing_strategy=str(row.default_routing_strategy),
            allowed_providers=list(row.allowed_providers or []),
            semantic_cache_enabled=bool(row.semantic_cache_enabled),
            cache_threshold=float(row.cache_threshold),
        )

    async def get_workspace_plan_limits(
        self,
        workspace_id: str,
    ) -> tuple[str, int | None, int | None, int | None]:
        result = await self.session.execute(
            text(
                """
                SELECT plan, requests_per_minute, tokens_per_minute, requests_per_day
                FROM workspaces WHERE id = :workspace_id
                """
            ),
            {"workspace_id": workspace_id},
        )
        row = result.one()
        return (
            str(row.plan),
            row.requests_per_minute,
            row.tokens_per_minute,
            row.requests_per_day,
        )

    async def find_models_for_routing(
        self,
        allowed_providers: list[str],
        complexity_levels: list[str],
    ) -> list[ModelRegistryRow]:
        params: dict[str, Any] = {"complexity_levels": complexity_levels}
        provider_filter = ""
        if allowed_providers:
            provider_filter = "AND provider::text = ANY(:allowed_providers)"
            params["allowed_providers"] = allowed_providers

        result = await self.session.execute(
            text(
                f"""
                SELECT *
                FROM model_registry
                WHERE is_enabled = true
                  AND availability_status IN ('AVAILABLE', 'DEGRADED')
                  AND supports_embeddings = false
                  AND complexity_min_level::text = ANY(:complexity_levels)
                  {provider_filter}
                ORDER BY quality_tier ASC, input_cost_per_million ASC
                """
            ),
            params,
        )
        return [_row_to_model(row) for row in result.fetchall()]

    async def find_model_by_provider_and_id(
        self,
        provider: str,
        model_id: str,
    ) -> ModelRegistryRow | None:
        result = await self.session.execute(
            text(
                """
                SELECT * FROM model_registry
                WHERE provider::text = :provider AND model_id = :model_id
                LIMIT 1
                """
            ),
            {"provider": provider, "model_id": model_id},
        )
        row = result.first()
        return _row_to_model(row) if row else None

    async def find_premium_model(self) -> ModelRegistryRow | None:
        result = await self.session.execute(
            text(
                """
                SELECT * FROM model_registry
                WHERE quality_tier = 'PREMIUM'
                  AND is_enabled = true
                  AND supports_embeddings = false
                ORDER BY input_cost_per_million DESC
                LIMIT 1
                """
            ),
        )
        row = result.first()
        return _row_to_model(row) if row else None

    async def find_fallback_models(
        self,
        primary_provider: str,
        primary_model: str,
        limit: int = 3,
    ) -> list[ModelRegistryRow]:
        result = await self.session.execute(
            text(
                """
                SELECT * FROM model_registry
                WHERE is_enabled = true
                  AND availability_status IN ('AVAILABLE', 'DEGRADED')
                  AND supports_embeddings = false
                  AND NOT (provider::text = :provider AND model_id = :model_id)
                ORDER BY quality_tier ASC, input_cost_per_million ASC
                LIMIT :limit
                """
            ),
            {"provider": primary_provider, "model_id": primary_model, "limit": limit},
        )
        return [_row_to_model(row) for row in result.fetchall()]

    async def create_request(self, data: dict[str, Any]) -> None:
        await self.session.execute(
            text(
                """
                INSERT INTO requests (
                    id, trace_id, workspace_id, api_key_id, model_registry_id, status,
                    prompt, system_prompt, requested_model, response, finish_reason,
                    input_tokens, output_tokens, total_tokens, actual_cost_usd,
                    baseline_cost_usd, savings_usd, total_latency_ms, provider_latency_ms,
                    cache_hit, cache_entry_id, cache_similarity_score, complexity_level,
                    fallback_used, retry_count, streaming_enabled
                ) VALUES (
                    :id::uuid, :trace_id::uuid, :workspace_id::uuid, :api_key_id::uuid,
                    :model_registry_id::uuid, :status::"RequestStatus",
                    :prompt, :system_prompt, :requested_model, :response, :finish_reason,
                    :input_tokens, :output_tokens, :total_tokens, :actual_cost_usd,
                    :baseline_cost_usd, :savings_usd, :total_latency_ms, :provider_latency_ms,
                    :cache_hit, :cache_entry_id::uuid, :cache_similarity_score,
                    :complexity_level::"ComplexityLevel", :fallback_used, :retry_count,
                    :streaming_enabled
                )
                """
            ),
            data,
        )
        await self.session.commit()

    async def create_routing_decision(self, data: dict[str, Any]) -> None:
        await self.session.execute(
            text(
                """
                INSERT INTO routing_decisions (
                    id, request_id, model_registry_id, strategy, complexity_level,
                    complexity_score, candidate_models, selection_reason,
                    estimated_cost_usd, decision_latency_ms
                ) VALUES (
                    gen_random_uuid(), :request_id::uuid, :model_registry_id::uuid,
                    :strategy::"LoadBalancingStrategy", :complexity_level::"ComplexityLevel",
                    :complexity_score, :candidate_models::jsonb, :selection_reason,
                    :estimated_cost_usd, :decision_latency_ms
                )
                """
            ),
            {**data, "candidate_models": json.dumps(data["candidate_models"])},
        )
        await self.session.commit()

    async def create_provider_log(self, data: dict[str, Any]) -> None:
        await self.session.execute(
            text(
                """
                INSERT INTO provider_logs (
                    id, request_id, model_registry_id, attempt_number, success,
                    latency_ms, input_tokens, output_tokens, cost_usd
                ) VALUES (
                    gen_random_uuid(), :request_id::uuid, :model_registry_id::uuid,
                    :attempt_number, :success, :latency_ms, :input_tokens,
                    :output_tokens, :cost_usd
                )
                """
            ),
            data,
        )
        await self.session.commit()

    async def create_fallback_event(self, data: dict[str, Any]) -> None:
        await self.session.execute(
            text(
                """
                INSERT INTO fallback_events (
                    id, request_id, failed_provider, failed_model_id,
                    fallback_provider, fallback_model_id, failure_reason,
                    success, fallback_latency_ms
                ) VALUES (
                    gen_random_uuid(), :request_id::uuid,
                    :failed_provider::"ProviderName", :failed_model_id,
                    :fallback_provider::"ProviderName", :fallback_model_id,
                    :failure_reason, :success, :fallback_latency_ms
                )
                """
            ),
            data,
        )
        await self.session.commit()

    async def get_active_budgets(self, workspace_id: str) -> list[Any]:
        result = await self.session.execute(
            text(
                """
                SELECT id, name, limit_usd, current_spend, block_at_100, alert_at_80, alert_at_90
                FROM budgets
                WHERE workspace_id = :workspace_id::uuid AND is_active = true
                """
            ),
            {"workspace_id": workspace_id},
        )
        return list(result.fetchall())

    async def update_budget_spend(self, workspace_id: str, cost_usd: float) -> None:
        await self.session.execute(
            text(
                """
                UPDATE budgets SET current_spend = current_spend + :cost_usd
                WHERE workspace_id = :workspace_id::uuid AND is_active = true
                """
            ),
            {"workspace_id": workspace_id, "cost_usd": cost_usd},
        )
        await self.session.commit()

    async def find_pending_budget_alert(
        self,
        workspace_id: str,
        budget_id: str,
        severity: str,
    ) -> Any | None:
        result = await self.session.execute(
            text(
                """
                SELECT id FROM budget_alerts
                WHERE workspace_id = :workspace_id::uuid
                  AND budget_id = :budget_id::uuid
                  AND severity = :severity::"AlertSeverity"
                  AND status IN ('PENDING', 'SENT')
                LIMIT 1
                """
            ),
            {"workspace_id": workspace_id, "budget_id": budget_id, "severity": severity},
        )
        return result.first()

    async def create_budget_alert(self, data: dict[str, Any]) -> None:
        await self.session.execute(
            text(
                """
                INSERT INTO budget_alerts (
                    id, workspace_id, budget_id, severity, status, threshold,
                    spend_at_alert, message
                ) VALUES (
                    gen_random_uuid(), :workspace_id::uuid, :budget_id::uuid,
                    :severity::"AlertSeverity", 'PENDING', :threshold,
                    :spend_at_alert, :message
                )
                """
            ),
            data,
        )
        await self.session.commit()

    async def update_cache_entry_hit(self, entry_id: str, cost_usd: float) -> None:
        await self.session.execute(
            text(
                """
                UPDATE cache_entries
                SET hit_count = hit_count + 1,
                    total_savings_usd = total_savings_usd + :cost_usd,
                    last_hit_at = NOW(),
                    updated_at = NOW()
                WHERE id = :entry_id::uuid
                """
            ),
            {"entry_id": entry_id, "cost_usd": cost_usd},
        )
        await self.session.commit()

    async def semantic_cache_search(
        self,
        embedding_str: str,
        workspace_id: str,
        threshold: float,
    ) -> list[Any]:
        result = await self.session.execute(
            text(
                """
                SELECT id, response, cost_usd,
                       1 - (embedding <=> :embedding::vector) AS similarity
                FROM cache_entries
                WHERE (workspace_id = :workspace_id::uuid OR workspace_id IS NULL)
                  AND (expires_at IS NULL OR expires_at > NOW())
                  AND 1 - (embedding <=> :embedding::vector) >= :threshold
                ORDER BY similarity DESC
                LIMIT 1
                """
            ),
            {"embedding": embedding_str, "workspace_id": workspace_id, "threshold": threshold},
        )
        return list(result.fetchall())

    async def store_cache_entry(self, data: dict[str, Any]) -> None:
        await self.session.execute(
            text(
                """
                INSERT INTO cache_entries (
                    id, workspace_id, prompt_hash, prompt, response,
                    model_id, provider, input_tokens, output_tokens, cost_usd,
                    embedding, expires_at, created_at, updated_at
                ) VALUES (
                    gen_random_uuid(), :workspace_id::uuid, :prompt_hash, :prompt, :response,
                    :model_id, :provider::"ProviderName", :input_tokens, :output_tokens,
                    :cost_usd, :embedding::vector, :expires_at, NOW(), NOW()
                )
                ON CONFLICT (prompt_hash) DO UPDATE SET
                    hit_count = cache_entries.hit_count,
                    updated_at = NOW()
                """
            ),
            data,
        )
        await self.session.commit()

    async def create_circuit_breaker_event(self, data: dict[str, Any]) -> None:
        await self.session.execute(
            text(
                """
                INSERT INTO circuit_breaker_events (
                    id, provider, model_id, from_state, to_state, reason,
                    failure_count, success_count, resolved_at
                ) VALUES (
                    gen_random_uuid(), :provider::"ProviderName", :model_id,
                    :from_state::"CircuitBreakerState", :to_state::"CircuitBreakerState",
                    :reason, :failure_count, :success_count, :resolved_at
                )
                """
            ),
            data,
        )
        await self.session.commit()

    async def list_models(
        self,
        provider: str | None = None,
        enabled: bool | None = None,
        quality_tier: str | None = None,
    ) -> list[ModelRegistryRow]:
        filters = ["1=1"]
        params: dict[str, Any] = {}
        if provider:
            filters.append("provider::text = :provider")
            params["provider"] = provider
        if enabled is not None:
            filters.append("is_enabled = :enabled")
            params["enabled"] = enabled
        if quality_tier:
            filters.append("quality_tier::text = :quality_tier")
            params["quality_tier"] = quality_tier

        result = await self.session.execute(
            text(
                f"""
                SELECT * FROM model_registry
                WHERE {' AND '.join(filters)}
                ORDER BY provider ASC, quality_tier ASC, input_cost_per_million ASC
                """
            ),
            params,
        )
        return [_row_to_model(row) for row in result.fetchall()]

    async def get_model_by_id(self, model_id: str) -> ModelRegistryRow | None:
        result = await self.session.execute(
            text("SELECT * FROM model_registry WHERE id = :id::uuid"),
            {"id": model_id},
        )
        row = result.first()
        return _row_to_model(row) if row else None

    async def get_embedding_model(self, model: str) -> ModelRegistryRow | None:
        result = await self.session.execute(
            text(
                """
                SELECT * FROM model_registry
                WHERE model_id = :model AND supports_embeddings = true AND is_enabled = true
                LIMIT 1
                """
            ),
            {"model": model},
        )
        row = result.first()
        return _row_to_model(row) if row else None

    async def create_model(self, data: dict[str, Any]) -> ModelRegistryRow:
        result = await self.session.execute(
            text(
                """
                INSERT INTO model_registry (
                    id, provider, model_id, display_name, description,
                    input_cost_per_million, output_cost_per_million, context_window,
                    max_output_tokens, supports_streaming, supports_vision,
                    supports_functions, supports_embeddings, quality_tier,
                    complexity_min_level, is_enabled
                ) VALUES (
                    gen_random_uuid(), :provider::"ProviderName", :model_id, :display_name,
                    :description, :input_cost_per_million, :output_cost_per_million,
                    :context_window, :max_output_tokens, :supports_streaming,
                    :supports_vision, :supports_functions, :supports_embeddings,
                    :quality_tier::"QualityTier", :complexity_min_level::"ComplexityLevel",
                    :is_enabled
                )
                RETURNING *
                """
            ),
            data,
        )
        await self.session.commit()
        return _row_to_model(result.one())

    async def update_model(self, model_id: str, data: dict[str, Any]) -> ModelRegistryRow:
        set_clauses = []
        params: dict[str, Any] = {"id": model_id}
        enum_fields = {
            "quality_tier": "QualityTier",
            "complexity_min_level": "ComplexityLevel",
            "availability_status": "AvailabilityStatus",
        }
        for key, value in data.items():
            if value is None:
                continue
            if key in enum_fields:
                set_clauses.append(f"{key} = :{key}::\"{enum_fields[key]}\"")
            else:
                set_clauses.append(f"{key} = :{key}")
            params[key] = value

        result = await self.session.execute(
            text(
                f"""
                UPDATE model_registry SET {', '.join(set_clauses)}, updated_at = NOW()
                WHERE id = :id::uuid
                RETURNING *
                """
            ),
            params,
        )
        await self.session.commit()
        return _row_to_model(result.one())

    async def delete_model(self, model_id: str) -> None:
        await self.session.execute(
            text("DELETE FROM model_registry WHERE id = :id::uuid"),
            {"id": model_id},
        )
        await self.session.commit()

    async def get_active_workspaces(self) -> list[str]:
        result = await self.session.execute(
            text(
                """
                SELECT id FROM workspaces
                WHERE is_active = true AND deleted_at IS NULL
                """
            ),
        )
        return [str(row.id) for row in result.fetchall()]

    async def aggregate_requests(
        self,
        workspace_id: str,
        window_from: datetime,
        window_to: datetime | None,
        statuses: list[str],
    ) -> tuple[float, float, float, int]:
        time_filter = "created_at >= :window_from"
        params: dict[str, Any] = {
            "workspace_id": workspace_id,
            "window_from": window_from,
            "statuses": statuses,
        }
        if window_to:
            time_filter += " AND created_at < :window_to"
            params["window_to"] = window_to

        result = await self.session.execute(
            text(
                f"""
                SELECT
                    COALESCE(AVG(actual_cost_usd), 0) AS avg_cost,
                    COALESCE(AVG(total_latency_ms), 0) AS avg_latency,
                    COALESCE(SUM(actual_cost_usd), 0) AS sum_cost,
                    COUNT(*) AS cnt
                FROM requests
                WHERE workspace_id = :workspace_id::uuid
                  AND {time_filter}
                  AND status::text = ANY(:statuses)
                """
            ),
            params,
        )
        row = result.one()
        return float(row.avg_cost), float(row.avg_latency), float(row.sum_cost), int(row.cnt)

    async def count_failed_requests(
        self,
        workspace_id: str,
        window_from: datetime,
    ) -> int:
        result = await self.session.execute(
            text(
                """
                SELECT COUNT(*) AS cnt FROM requests
                WHERE workspace_id = :workspace_id::uuid
                  AND created_at >= :window_from
                  AND status = 'FAILED'
                """
            ),
            {"workspace_id": workspace_id, "window_from": window_from},
        )
        return int(result.one().cnt)

    async def create_notification(self, data: dict[str, Any]) -> None:
        await self.session.execute(
            text(
                """
                INSERT INTO notifications (
                    id, workspace_id, type, title, body, metadata
                ) VALUES (
                    gen_random_uuid(), :workspace_id::uuid,
                    :type::"NotificationType", :title, :body, :metadata::jsonb
                )
                """
            ),
            {**data, "metadata": json.dumps(data.get("metadata", {}))},
        )
        await self.session.commit()

    async def model_exists(self, provider: str, model_id: str) -> bool:
        result = await self.session.execute(
            text(
                """
                SELECT id FROM model_registry
                WHERE provider::text = :provider AND model_id = :model_id
                """
            ),
            {"provider": provider, "model_id": model_id},
        )
        return result.first() is not None

    async def check_admin_membership(self, user_id: str, workspace_id: str) -> bool:
        result = await self.session.execute(
            text(
                """
                SELECT role FROM workspace_members
                WHERE user_id = :user_id::uuid AND workspace_id = :workspace_id::uuid
                """
            ),
            {"user_id": user_id, "workspace_id": workspace_id},
        )
        row = result.first()
        return bool(row and str(row.role) in ("OWNER", "ADMIN"))
