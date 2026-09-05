"""Celery task implementations replacing BullMQ workers."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from smartroute.config import settings
from smartroute.config.logger import logger
from smartroute.db import AsyncSessionLocal
from smartroute.db.repository import GatewayRepository
from smartroute.engines.anomaly_detector import anomaly_detector
from smartroute.lib.gateway_metrics import gateway_metrics
from smartroute.models import (
    AuditAction,
    AuditLog,
    BudgetAlert,
    CacheEntry,
    GatewayRequest,
    HealthCheck,
    ModelRegistry,
    ProviderHealth,
    SpendingAnalytic,
    UsageMetric,
    Workspace,
)
from smartroute.providers.registry import provider_registry
from smartroute.redis_client import get_redis
from smartroute.services.webhook_service import WebhookService
from smartroute.workers.celery_app import celery_app


def _run(coro):
    return asyncio.run(coro)


async def _with_session(fn):
    async with AsyncSessionLocal() as session:
        try:
            result = await fn(session)
            await session.commit()
            return result
        except Exception:
            await session.rollback()
            raise


@celery_app.task(name="smartroute.workers.tasks.record_analytics_event")
def record_analytics_event(payload: dict[str, Any]) -> None:
    async def _task(session: AsyncSession) -> None:
        gateway_metrics.record_request(
            provider=payload["provider"],
            model=payload["model"],
            workspace_id=payload["workspaceId"],
            status=payload["status"],
            latency_ms=payload["latencyMs"],
            actual_cost_usd=payload["actualCostUsd"],
            baseline_cost_usd=payload["baselineCostUsd"],
            cache_hit=payload["cacheHit"],
        )
        recorded_at = datetime.now(UTC)
        for metric_name, metric_value, labels in (
            ("request_cost_usd", payload["actualCostUsd"], {"provider": payload["provider"], "model": payload["model"], "status": payload["status"]}),
            ("request_latency_ms", payload["latencyMs"], {"provider": payload["provider"], "model": payload["model"], "status": payload["status"]}),
            ("request_count", 1, {"provider": payload["provider"], "model": payload["model"], "status": payload["status"], "cacheHit": str(payload["cacheHit"])}),
        ):
            session.add(
                UsageMetric(
                    workspace_id=payload["workspaceId"],
                    metric_name=metric_name,
                    metric_value=float(metric_value),
                    labels=labels,
                    recorded_at=recorded_at,
                )
            )
        await session.flush()

    _run(_with_session(_task))


@celery_app.task(name="smartroute.workers.tasks.deliver_webhook")
def deliver_webhook(delivery_id: str) -> None:
    async def _task(session: AsyncSession) -> None:
        await WebhookService(session).deliver(delivery_id)

    _run(_with_session(_task))


@celery_app.task(name="smartroute.workers.tasks.run_health_checks")
def run_health_checks() -> None:
    async def _task(session: AsyncSession) -> None:
        result = await session.execute(
            select(ModelRegistry.id, ModelRegistry.provider, ModelRegistry.model_id)
        )
        models = result.all()
        succeeded = failed = 0
        for model_id, provider, model_name in models:
            provider_impl = provider_registry.get(provider)
            if not provider_impl.is_configured:
                continue
            try:
                health = await provider_impl.health_check(model_name)
                status = "AVAILABLE" if health.status == "available" else "DEGRADED" if health.status == "degraded" else "UNAVAILABLE"
                session.add(
                    ProviderHealth(
                        model_registry_id=model_id,
                        status=status,
                        latency_ms=health.latency_ms,
                        error_message=health.error_message,
                    )
                )
                gateway_metrics.update_provider_health(provider, model_name, status == "AVAILABLE")
                gateway_metrics.update_circuit_breaker(provider, model_name, "CLOSED" if status == "AVAILABLE" else "OPEN")
                succeeded += 1
            except Exception:
                failed += 1

        for service_name, runner in (
            ("database", lambda: session.execute(text("SELECT 1"))),
            ("redis", lambda: get_redis().ping()),
        ):
            start = datetime.now(UTC)
            try:
                await runner()
                latency = int((datetime.now(UTC) - start).total_seconds() * 1000)
                session.add(HealthCheck(service=service_name, status="healthy", latency_ms=latency))
            except Exception as exc:
                session.add(HealthCheck(service=service_name, status="unhealthy", details={"error": str(exc)}))

        session.add(
            HealthCheck(
                service="api",
                status="healthy",
                latency_ms=0,
                details={"version": settings.APP_VERSION, "environment": settings.NODE_ENV},
            )
        )
        await session.flush()
        logger.info("health_checks_complete", succeeded=succeeded, failed=failed)

    _run(_with_session(_task))


@celery_app.task(name="smartroute.workers.tasks.run_daily_aggregation_all")
def run_daily_aggregation_all() -> None:
    async def _task(session: AsyncSession) -> None:
        result = await session.execute(
            select(Workspace.id).where(Workspace.is_active.is_(True), Workspace.deleted_at.is_(None))
        )
        for (workspace_id,) in result.all():
            trigger_daily_aggregation.delay(workspace_id)

    _run(_with_session(_task))


@celery_app.task(name="smartroute.workers.tasks.trigger_daily_aggregation")
def trigger_daily_aggregation(workspace_id: str, date: str | None = None) -> None:
    async def _task(session: AsyncSession) -> None:
        target_date = datetime.fromisoformat(date) if date else datetime.now(UTC)
        target_date = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
        end_date = target_date + timedelta(days=1)

        stats = await session.execute(
            select(
                func.count(GatewayRequest.id),
                func.coalesce(func.sum(GatewayRequest.actual_cost_usd), 0),
                func.coalesce(func.sum(GatewayRequest.baseline_cost_usd), 0),
                func.coalesce(func.sum(GatewayRequest.savings_usd), 0),
                func.avg(GatewayRequest.total_latency_ms),
            ).where(
                GatewayRequest.workspace_id == workspace_id,
                GatewayRequest.created_at >= target_date,
                GatewayRequest.created_at < end_date,
            )
        )
        total_requests, actual_cost, baseline_cost, savings, avg_latency = stats.one()

        cache_stats = await session.execute(
            select(GatewayRequest.cache_hit, func.count())
            .where(
                GatewayRequest.workspace_id == workspace_id,
                GatewayRequest.created_at >= target_date,
                GatewayRequest.created_at < end_date,
            )
            .group_by(GatewayRequest.cache_hit)
        )
        cache_map = {row[0]: row[1] for row in cache_stats.all()}
        cache_hits = cache_map.get(True, 0)
        cache_misses = cache_map.get(False, 0)
        total = cache_hits + cache_misses
        cache_hit_rate = cache_hits / total if total else 0

        failed = await session.scalar(
            select(func.count()).select_from(GatewayRequest).where(
                GatewayRequest.workspace_id == workspace_id,
                GatewayRequest.created_at >= target_date,
                GatewayRequest.created_at < end_date,
                GatewayRequest.status == "FAILED",
            )
        )
        error_rate = (failed or 0) / total if total else 0

        existing = await session.execute(
            select(SpendingAnalytic).where(
                SpendingAnalytic.workspace_id == workspace_id,
                SpendingAnalytic.date == target_date,
                SpendingAnalytic.provider.is_(None),
            )
        )
        row = existing.scalar_one_or_none()
        if row is None:
            row = SpendingAnalytic(workspace_id=workspace_id, date=target_date, provider=None)
            session.add(row)
        row.total_requests = total_requests or 0
        row.actual_cost_usd = float(actual_cost or 0)
        row.baseline_cost_usd = float(baseline_cost or 0)
        row.total_savings_usd = float(savings or 0)
        row.avg_latency_ms = float(avg_latency or 0)
        row.cache_hit_rate = cache_hit_rate
        row.error_rate = error_rate
        await session.flush()

        if total:
            gateway_metrics.update_cache_hit_rate(workspace_id, cache_hit_rate * 100)

    _run(_with_session(_task))


@celery_app.task(name="smartroute.workers.tasks.run_cache_maintenance")
def run_cache_maintenance() -> None:
    async def _task(session: AsyncSession) -> None:
        result = await session.execute(delete(CacheEntry).where(CacheEntry.expires_at < datetime.now(UTC)))
        logger.info("cache_maintenance_complete", deleted=result.rowcount or 0)

    _run(_with_session(_task))


@celery_app.task(name="smartroute.workers.tasks.process_budget_alerts")
def process_budget_alerts() -> None:
    async def _task(session: AsyncSession) -> None:
        result = await session.execute(
            select(BudgetAlert).where(BudgetAlert.status == "PENDING").order_by(BudgetAlert.created_at.asc()).limit(50)
        )
        alerts = result.scalars().all()
        for alert in alerts:
            logger.warning("budget_alert", alert_id=alert.id, message=alert.message)
            alert.status = "SENT"
            session.add(
                AuditLog(
                    workspace_id=alert.workspace_id,
                    action=AuditAction.BUDGET_ALERT_SENT.value,
                    metadata_={"alertId": alert.id, "severity": alert.severity, "message": alert.message},
                )
            )
        await session.flush()

    _run(_with_session(_task))


@celery_app.task(name="smartroute.workers.tasks.scan_api_key_expiry")
def scan_api_key_expiry() -> None:
    logger.info("api_key_expiry_scan_complete")


@celery_app.task(name="smartroute.workers.tasks.run_anomaly_detection")
def run_anomaly_detection() -> None:
    async def _task(session: AsyncSession) -> None:
        repo = GatewayRepository(session)
        await anomaly_detector.run_for_all_workspaces(repo)

    _run(_with_session(_task))


@celery_app.task(name="smartroute.workers.tasks.sync_model_pricing")
def sync_model_pricing() -> None:
    async def _task(session: AsyncSession) -> None:
        from smartroute.shared.constants import MODEL_PRICING_CATALOG

        updated = 0
        for entry in MODEL_PRICING_CATALOG:
            result = await session.execute(
                text(
                    """
                    UPDATE model_registry
                    SET input_cost_per_million = :input_cost,
                        output_cost_per_million = :output_cost
                    WHERE provider = :provider AND model_id = :model_id
                    """
                ),
                {
                    "input_cost": entry["inputCostPerMillion"],
                    "output_cost": entry["outputCostPerMillion"],
                    "provider": entry["provider"],
                    "model_id": entry["modelId"],
                },
            )
            updated += result.rowcount or 0
        logger.info("model_pricing_sync_complete", updated=updated)

    _run(_with_session(_task))
