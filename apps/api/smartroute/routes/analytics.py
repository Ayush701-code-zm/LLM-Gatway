"""Analytics routes — /api/v1/analytics."""

from __future__ import annotations

import csv
import io
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from smartroute.db import get_db
from smartroute.db.repository import GatewayRepository
from smartroute.errors import AppError
from smartroute.middleware.auth import (
    AuthPayload,
    can_write,
    load_workspace_role,
    require_auth,
)
from smartroute.models import (
    CircuitBreakerEvent,
    FallbackEvent,
    GatewayRequest,
    Notification,
    ProviderLog,
    SpendingAnalytic,
    UsageMetric,
)
from smartroute.routes.deps import get_repository
from smartroute.services.gateway_service import GatewayOptions, gateway_service
from smartroute.shared.schemas import ChatRequest
from smartroute.types.gateway import ApiKeyContext
from smartroute.models import ApiKey

router = APIRouter(prefix="/analytics", tags=["analytics"], dependencies=[Depends(require_auth), Depends(load_workspace_role)])


from smartroute.lib.responses import success_response


def _ok(data: object, status_code: int = status.HTTP_200_OK, **extra) -> Response:
    return success_response(data, status_code=status_code, **extra)


def _pct(n: int, total: int) -> str:
    return f"{(n / total * 100):.1f}" if total > 0 else "0.0"


@router.get("/overview")
async def analytics_overview(
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    workspace_id = user.workspace_id
    since = datetime.now(UTC) - timedelta(days=30)

    total_requests = await db.scalar(
        select(func.count()).select_from(GatewayRequest).where(
            GatewayRequest.workspace_id == workspace_id,
            GatewayRequest.created_at >= since,
        )
    )
    spend = await db.execute(
        select(
            func.coalesce(func.sum(GatewayRequest.actual_cost_usd), 0),
            func.coalesce(func.sum(GatewayRequest.savings_usd), 0),
        ).where(GatewayRequest.workspace_id == workspace_id, GatewayRequest.created_at >= since)
    )
    total_cost, total_savings = spend.one()

    cache_stats = await db.execute(
        select(GatewayRequest.cache_hit, func.count())
        .where(GatewayRequest.workspace_id == workspace_id, GatewayRequest.created_at >= since)
        .group_by(GatewayRequest.cache_hit)
    )
    cache_map = {row[0]: row[1] for row in cache_stats.all()}
    cache_hits = cache_map.get(True, 0)
    cache_misses = cache_map.get(False, 0)

    avg_latency = await db.scalar(
        select(func.avg(GatewayRequest.total_latency_ms)).where(
            GatewayRequest.workspace_id == workspace_id,
            GatewayRequest.created_at >= since,
            GatewayRequest.status == "COMPLETED",
        )
    )

    fallback_count = await db.scalar(
        select(func.count()).select_from(GatewayRequest).where(
            GatewayRequest.workspace_id == workspace_id,
            GatewayRequest.created_at >= since,
            GatewayRequest.fallback_used.is_(True),
        )
    )
    retry_count = await db.scalar(
        select(func.count()).select_from(GatewayRequest).where(
            GatewayRequest.workspace_id == workspace_id,
            GatewayRequest.created_at >= since,
            GatewayRequest.retry_count > 0,
        )
    )
    cache_savings = await db.scalar(
        select(func.coalesce(func.sum(GatewayRequest.savings_usd), 0)).where(
            GatewayRequest.workspace_id == workspace_id,
            GatewayRequest.created_at >= since,
            GatewayRequest.cache_hit.is_(True),
        )
    )
    success_count = await db.scalar(
        select(func.count()).select_from(GatewayRequest).where(
            GatewayRequest.workspace_id == workspace_id,
            GatewayRequest.created_at >= since,
            GatewayRequest.status.in_(["COMPLETED", "CACHED"]),
        )
    )

    total_requests = total_requests or 0
    total_cost = float(total_cost or 0)
    total_savings = float(total_savings or 0)
    savings_denom = total_cost + total_savings

    return _ok(
        {
            "totalRequests": total_requests,
            "totalCostUsd": total_cost,
            "totalSavingsUsd": total_savings,
            "savingsPercent": f"{(total_savings / savings_denom * 100):.1f}" if savings_denom > 0 else 0,
            "cacheHitRate": _pct(cache_hits, total_requests),
            "cacheHits": cache_hits,
            "cacheMisses": cache_misses,
            "cacheSavingsUsd": float(cache_savings or 0),
            "avgLatencyMs": round(float(avg_latency or 0)),
            "successRate": _pct(success_count or 0, total_requests),
            "fallbackRate": _pct(fallback_count or 0, total_requests),
            "retryRate": _pct(retry_count or 0, total_requests),
            "period": "30d",
        }
    )


@router.get("/spend/daily")
async def spend_daily(
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
    days: int = Query(30),
):
    since = datetime.now(UTC) - timedelta(days=days)
    result = await db.execute(
        select(SpendingAnalytic)
        .where(SpendingAnalytic.workspace_id == user.workspace_id, SpendingAnalytic.date >= since)
        .order_by(SpendingAnalytic.date.asc())
    )
    rows = [
        {
            "id": r.id,
            "date": r.date.isoformat(),
            "provider": r.provider,
            "totalRequests": r.total_requests,
            "actualCostUsd": r.actual_cost_usd,
            "totalSavingsUsd": r.total_savings_usd,
            "avgLatencyMs": r.avg_latency_ms,
            "cacheHitRate": r.cache_hit_rate,
            "errorRate": r.error_rate,
        }
        for r in result.scalars().all()
    ]
    return _ok(rows)


@router.get("/requests")
async def list_requests(
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
):
    workspace_id = user.workspace_id
    skip = (page - 1) * limit
    total = await db.scalar(
        select(func.count()).select_from(GatewayRequest).where(GatewayRequest.workspace_id == workspace_id)
    )
    result = await db.execute(
        select(GatewayRequest)
        .options(selectinload(GatewayRequest.model))
        .where(GatewayRequest.workspace_id == workspace_id)
        .order_by(GatewayRequest.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    rows = [
        {
            "id": r.id,
            "traceId": r.trace_id,
            "status": r.status,
            "requestedModel": r.requested_model,
            "cacheHit": r.cache_hit,
            "complexityLevel": r.complexity_level,
            "inputTokens": r.input_tokens,
            "outputTokens": r.output_tokens,
            "actualCostUsd": r.actual_cost_usd,
            "savingsUsd": r.savings_usd,
            "totalLatencyMs": r.total_latency_ms,
            "fallbackUsed": r.fallback_used,
            "retryCount": r.retry_count,
            "createdAt": r.created_at.isoformat() if r.created_at else None,
            "model": {"provider": r.model.provider, "modelId": r.model.model_id} if r.model else None,
        }
        for r in result.scalars().all()
    ]
    total = total or 0
    return _ok(
        rows,
        pagination={
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": (total + limit - 1) // limit if limit else 0,
            "hasNext": page * limit < total,
            "hasPrev": page > 1,
        },
    )


@router.get("/requests/{request_id}")
async def get_request(
    request_id: str,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(GatewayRequest)
        .options(selectinload(GatewayRequest.model))
        .where(GatewayRequest.id == request_id, GatewayRequest.workspace_id == user.workspace_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise AppError.not_found("Request not found")
    return _ok(
        {
            "id": row.id,
            "traceId": row.trace_id,
            "status": row.status,
            "prompt": row.prompt,
            "systemPrompt": row.system_prompt,
            "response": row.response,
            "requestedModel": row.requested_model,
            "cacheHit": row.cache_hit,
            "complexityLevel": row.complexity_level,
            "inputTokens": row.input_tokens,
            "outputTokens": row.output_tokens,
            "actualCostUsd": row.actual_cost_usd,
            "savingsUsd": row.savings_usd,
            "totalLatencyMs": row.total_latency_ms,
            "fallbackUsed": row.fallback_used,
            "retryCount": row.retry_count,
            "finishReason": row.finish_reason,
            "createdAt": row.created_at.isoformat() if row.created_at else None,
            "model": {"provider": row.model.provider, "modelId": row.model.model_id} if row.model else None,
        }
    )


@router.post("/requests/{request_id}/replay", dependencies=[Depends(can_write)])
async def replay_request(
    request_id: str,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
    repo: Annotated[GatewayRepository, Depends(get_repository)],
):
    result = await db.execute(
        select(GatewayRequest).where(
            GatewayRequest.id == request_id,
            GatewayRequest.workspace_id == user.workspace_id,
        )
    )
    original = result.scalar_one_or_none()
    if not original:
        raise AppError.not_found("Request not found")

    key_result = await db.execute(
        select(ApiKey).where(
            ApiKey.id == original.api_key_id,
            ApiKey.workspace_id == user.workspace_id,
            ApiKey.status == "ACTIVE",
        )
    )
    api_key_record = key_result.scalar_one_or_none()
    if not api_key_record or (api_key_record.expires_at and api_key_record.expires_at < datetime.now(UTC)):
        fallback = await db.execute(
            select(ApiKey)
            .where(ApiKey.workspace_id == user.workspace_id, ApiKey.status == "ACTIVE")
            .order_by(ApiKey.created_at.asc())
            .limit(1)
        )
        api_key_record = fallback.scalar_one_or_none()

    if not api_key_record:
        raise AppError.bad_request("No active API key in this workspace. Create one to replay requests.")

    api_key = ApiKeyContext(
        id=api_key_record.id,
        workspace_id=api_key_record.workspace_id,
        scopes=list(api_key_record.scopes or []),
    )
    response = await gateway_service.process_chat(
        ChatRequest(
            message=original.prompt,
            systemPrompt=original.system_prompt,
            model=original.requested_model or "auto",
            stream=False,
        ),
        GatewayOptions(request_id=str(uuid.uuid4()), trace_id=str(uuid.uuid4()), api_key=api_key),
        repo,
    )
    return _ok({"replayedFromId": original.id, "response": response})


@router.get("/providers")
async def provider_stats(
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(
            ProviderLog.model_registry_id,
            func.count(ProviderLog.id),
            func.coalesce(func.sum(ProviderLog.cost_usd), 0),
            func.coalesce(func.sum(ProviderLog.latency_ms), 0),
            func.avg(ProviderLog.latency_ms),
        )
        .join(GatewayRequest, GatewayRequest.id == ProviderLog.request_id)
        .where(GatewayRequest.workspace_id == user.workspace_id)
        .group_by(ProviderLog.model_registry_id)
    )
    data = [
        {
            "modelRegistryId": row[0],
            "_count": {"id": row[1]},
            "_sum": {"costUsd": float(row[2]), "latencyMs": float(row[3])},
            "_avg": {"latencyMs": float(row[4] or 0)},
        }
        for row in result.all()
    ]
    return _ok(data)


@router.get("/reliability")
async def reliability(
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
    days: int = Query(30, ge=1, le=90),
):
    workspace_id = user.workspace_id
    since = datetime.now(UTC) - timedelta(days=days)

    total_requests = await db.scalar(
        select(func.count()).select_from(GatewayRequest).where(
            GatewayRequest.workspace_id == workspace_id,
            GatewayRequest.created_at >= since,
        )
    )
    fallback_count = await db.scalar(
        select(func.count()).select_from(GatewayRequest).where(
            GatewayRequest.workspace_id == workspace_id,
            GatewayRequest.created_at >= since,
            GatewayRequest.fallback_used.is_(True),
        )
    )
    retry_count = await db.scalar(
        select(func.count()).select_from(GatewayRequest).where(
            GatewayRequest.workspace_id == workspace_id,
            GatewayRequest.created_at >= since,
            GatewayRequest.retry_count > 0,
        )
    )
    failed_count = await db.scalar(
        select(func.count()).select_from(GatewayRequest).where(
            GatewayRequest.workspace_id == workspace_id,
            GatewayRequest.created_at >= since,
            GatewayRequest.status == "FAILED",
        )
    )
    circuit_breaker_opens = await db.scalar(
        select(func.count()).select_from(CircuitBreakerEvent).where(
            CircuitBreakerEvent.created_at >= since,
            CircuitBreakerEvent.to_state == "OPEN",
        )
    )

    fallback_by_provider = await db.execute(
        select(FallbackEvent.failed_provider, FallbackEvent.fallback_provider, func.count())
        .join(GatewayRequest, GatewayRequest.id == FallbackEvent.request_id)
        .where(GatewayRequest.workspace_id == workspace_id, GatewayRequest.created_at >= since)
        .group_by(FallbackEvent.failed_provider, FallbackEvent.fallback_provider)
        .order_by(func.count().desc())
    )

    recent_fallbacks = await db.execute(
        select(FallbackEvent)
        .join(GatewayRequest, GatewayRequest.id == FallbackEvent.request_id)
        .options(selectinload(FallbackEvent.request))
        .where(GatewayRequest.workspace_id == workspace_id, GatewayRequest.created_at >= since)
        .order_by(FallbackEvent.created_at.desc())
        .limit(15)
    )
    recent_circuit = await db.execute(
        select(CircuitBreakerEvent)
        .where(CircuitBreakerEvent.created_at >= since)
        .order_by(CircuitBreakerEvent.created_at.desc())
        .limit(15)
    )

    total_requests = total_requests or 0
    return _ok(
        {
            "period": f"{days}d",
            "totalRequests": total_requests,
            "fallbackCount": fallback_count or 0,
            "fallbackRate": _pct(fallback_count or 0, total_requests),
            "retryCount": retry_count or 0,
            "retryRate": _pct(retry_count or 0, total_requests),
            "failedCount": failed_count or 0,
            "errorRate": _pct(failed_count or 0, total_requests),
            "circuitBreakerOpens": circuit_breaker_opens or 0,
            "fallbackByProvider": [
                {"failedProvider": r[0], "fallbackProvider": r[1], "count": r[2]}
                for r in fallback_by_provider.all()
            ],
            "recentFallbacks": [
                {
                    "id": f.id,
                    "failedProvider": f.failed_provider,
                    "fallbackProvider": f.fallback_provider,
                    "createdAt": f.created_at.isoformat() if f.created_at else None,
                    "request": {
                        "id": f.request.id,
                        "traceId": f.request.trace_id,
                        "requestedModel": f.request.requested_model,
                    },
                }
                for f in recent_fallbacks.scalars().all()
            ],
            "recentCircuitEvents": [
                {
                    "id": e.id,
                    "provider": e.provider,
                    "modelId": e.model_id,
                    "fromState": e.from_state,
                    "toState": e.to_state,
                    "reason": e.reason,
                    "createdAt": e.created_at.isoformat() if e.created_at else None,
                }
                for e in recent_circuit.scalars().all()
            ],
        }
    )


@router.get("/usage")
async def usage_metrics(
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
    days: int = Query(30, ge=1, le=90),
):
    since = datetime.now(UTC) - timedelta(days=days)
    result = await db.execute(
        select(UsageMetric)
        .where(UsageMetric.workspace_id == user.workspace_id, UsageMetric.recorded_at >= since)
        .order_by(UsageMetric.recorded_at.asc())
    )
    daily: dict[str, dict[str, float]] = {}
    for row in result.scalars().all():
        day = row.recorded_at.date().isoformat()
        bucket = daily.setdefault(day, {"cost": 0.0, "requests": 0.0, "latencySum": 0.0, "latencyCount": 0.0})
        if row.metric_name == "request_cost_usd":
            bucket["cost"] += row.metric_value
        elif row.metric_name == "request_count":
            bucket["requests"] += row.metric_value
        elif row.metric_name == "request_latency_ms":
            bucket["latencySum"] += row.metric_value
            bucket["latencyCount"] += 1

    series = [
        {
            "date": day,
            "costUsd": values["cost"],
            "requests": round(values["requests"]),
            "avgLatencyMs": round(values["latencySum"] / values["latencyCount"]) if values["latencyCount"] else 0,
        }
        for day, values in sorted(daily.items())
    ]
    return _ok({"period": f"{days}d", "series": series})


@router.get("/anomalies")
async def anomalies(
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
    days: int = Query(30, ge=1, le=90),
):
    since = datetime.now(UTC) - timedelta(days=days)
    result = await db.execute(
        select(Notification)
        .where(
            Notification.workspace_id == user.workspace_id,
            Notification.type == "ANOMALY_DETECTED",
            Notification.created_at >= since,
        )
        .order_by(Notification.created_at.desc())
        .limit(50)
    )
    rows = result.scalars().all()
    return _ok(
        {
            "period": f"{days}d",
            "count": len(rows),
            "anomalies": [
                {
                    "id": n.id,
                    "type": n.type,
                    "title": n.title,
                    "body": n.body,
                    "metadata": n.metadata_,
                    "createdAt": n.created_at.isoformat() if n.created_at else None,
                }
                for n in rows
            ],
        }
    )


@router.get("/export")
async def export_requests(
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
    format: str = Query("json"),
    limit: int = Query(5000, ge=1, le=10000),
    from_date: str | None = Query(None, alias="from"),
    to_date: str | None = Query(None, alias="to"),
):
    now = datetime.now(UTC)
    try:
        from_dt = datetime.fromisoformat(from_date.replace("Z", "+00:00")) if from_date else now - timedelta(days=30)
        to_dt = datetime.fromisoformat(to_date.replace("Z", "+00:00")) if to_date else now
    except ValueError:
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": {"code": "INVALID_DATE", "message": "Invalid from/to date"}},
        )

    result = await db.execute(
        select(GatewayRequest)
        .where(
            GatewayRequest.workspace_id == user.workspace_id,
            GatewayRequest.created_at >= from_dt,
            GatewayRequest.created_at <= to_dt,
        )
        .order_by(GatewayRequest.created_at.desc())
        .limit(limit)
    )
    rows = result.scalars().all()

    if format == "csv":
        cols = [
            "id", "traceId", "createdAt", "requestedModel", "status",
            "inputTokens", "outputTokens", "totalTokens",
            "actualCostUsd", "baselineCostUsd", "savingsUsd",
            "totalLatencyMs", "complexityLevel",
            "cacheHit", "fallbackUsed", "retryCount", "finishReason",
        ]
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(cols)

        def escape(v: object) -> str:
            s = "" if v is None else str(v)
            if any(ch in s for ch in ',\n"'):
                return '"' + s.replace('"', '""') + '"'
            return s

        for row in rows:
            values = {
                "id": row.id,
                "traceId": row.trace_id,
                "createdAt": row.created_at.isoformat() if row.created_at else "",
                "requestedModel": row.requested_model,
                "status": row.status,
                "inputTokens": row.input_tokens,
                "outputTokens": row.output_tokens,
                "totalTokens": row.total_tokens,
                "actualCostUsd": row.actual_cost_usd,
                "baselineCostUsd": row.baseline_cost_usd,
                "savingsUsd": row.savings_usd,
                "totalLatencyMs": row.total_latency_ms,
                "complexityLevel": row.complexity_level,
                "cacheHit": row.cache_hit,
                "fallbackUsed": row.fallback_used,
                "retryCount": row.retry_count,
                "finishReason": row.finish_reason,
            }
            writer.writerow([escape(values[c]) for c in cols])

        filename = f"smartroute-requests-{from_dt.date().isoformat()}-{to_dt.date().isoformat()}.csv"
        return PlainTextResponse(
            content=output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    return JSONResponse(
        status_code=200,
        content={
            "success": True,
            "data": [
                {
                    "id": r.id,
                    "traceId": r.trace_id,
                    "createdAt": r.created_at.isoformat() if r.created_at else None,
                    "requestedModel": r.requested_model,
                    "status": r.status,
                    "inputTokens": r.input_tokens,
                    "outputTokens": r.output_tokens,
                    "totalTokens": r.total_tokens,
                    "actualCostUsd": r.actual_cost_usd,
                    "baselineCostUsd": r.baseline_cost_usd,
                    "savingsUsd": r.savings_usd,
                    "totalLatencyMs": r.total_latency_ms,
                    "complexityLevel": r.complexity_level,
                    "cacheHit": r.cache_hit,
                    "fallbackUsed": r.fallback_used,
                    "retryCount": r.retry_count,
                    "finishReason": r.finish_reason,
                }
                for r in rows
            ],
            "meta": {
                "count": len(rows),
                "from": from_dt.isoformat(),
                "to": to_dt.isoformat(),
                "limit": limit,
                "truncated": len(rows) == limit,
            },
        },
    )
