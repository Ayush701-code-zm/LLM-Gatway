"""Workspace routes — /api/v1/workspaces."""

from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from smartroute.db import get_db
from smartroute.db.repository import GatewayRepository
from smartroute.routes.deps import get_repository
from smartroute.engines.rate_limiter import rate_limiter_engine
from smartroute.errors import AppError
from smartroute.lib.audit_csv import audit_slug_columns
from smartroute.lib.plan_enforcement import enforce_budget_limit
from smartroute.lib.sync_rate_limit import sync_rate_limit_record
from smartroute.middleware.auth import (
    AuthPayload,
    can_admin,
    get_auth_user_id,
    get_auth_workspace_id,
    load_workspace_role,
    require_auth,
)
from smartroute.models import ApiKey, AuditAction, AuditLog, Budget, Notification, ProviderHealth, Workspace, WorkspaceMember
from smartroute.schemas.workspace import CreateBudgetRequest, CreateWorkspaceRequest, PatchWorkspaceRequest
from smartroute.services.auth_service import AuthService

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


from smartroute.lib.responses import success_response


def _ok(data: object, status_code: int = status.HTTP_200_OK) -> Response:
    return success_response(data, status_code=status_code)


def _workspace_to_dict(workspace: Workspace) -> dict:
    return {
        "id": workspace.id,
        "slug": workspace.slug,
        "name": workspace.name,
        "description": workspace.description,
        "logoUrl": workspace.logo_url,
        "plan": workspace.plan,
        "isActive": workspace.is_active,
        "defaultRoutingStrategy": workspace.default_routing_strategy,
        "allowedProviders": workspace.allowed_providers,
        "semanticCacheEnabled": workspace.semantic_cache_enabled,
        "cacheThreshold": workspace.cache_threshold,
        "requestsPerMinute": workspace.requests_per_minute,
        "tokensPerMinute": workspace.tokens_per_minute,
        "requestsPerDay": workspace.requests_per_day,
        "createdAt": workspace.created_at.isoformat() if workspace.created_at else None,
        "updatedAt": workspace.updated_at.isoformat() if workspace.updated_at else None,
    }


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_workspace(
    body: CreateWorkspaceRequest,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await AuthService(db).create_workspace(user.sub, body.name)
    serialized = {
        "user": result["user"].model_dump(by_alias=True, mode="json"),
        "tokens": result["tokens"].model_dump(by_alias=True, mode="json"),
    }
    return _ok(serialized, status.HTTP_201_CREATED)


@router.get("/current", dependencies=[Depends(load_workspace_role)])
async def get_current_workspace(
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(Workspace)
        .options(
            selectinload(Workspace.members).selectinload(WorkspaceMember.user),
            selectinload(Workspace.budgets),
        )
        .where(Workspace.id == user.workspace_id)
    )
    workspace = result.scalar_one_or_none()
    if not workspace:
        raise AppError.not_found("Workspace not found")

    api_key_count = await db.scalar(
        select(func.count()).select_from(ApiKey).where(ApiKey.workspace_id == workspace.id)
    )

    data = _workspace_to_dict(workspace)
    data["members"] = [
        {
            "id": m.id,
            "role": m.role,
            "userId": m.user_id,
            "joinedAt": m.joined_at.isoformat() if m.joined_at else None,
            "user": {
                "id": m.user.id,
                "name": m.user.name,
                "email": m.user.email,
                "avatarUrl": m.user.avatar_url,
            },
        }
        for m in workspace.members
    ]
    data["budgets"] = [
        {
            "id": b.id,
            "name": b.name,
            "limitUsd": b.limit_usd,
            "period": b.period,
            "currentSpend": b.current_spend,
            "isActive": b.is_active,
        }
        for b in workspace.budgets
        if b.is_active
    ]
    data["_count"] = {"requests": 0, "apiKeys": api_key_count or 0}
    return _ok(data)


@router.patch("/current", dependencies=[Depends(load_workspace_role), Depends(can_admin)])
async def patch_current_workspace(
    body: PatchWorkspaceRequest,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    workspace_id = get_auth_workspace_id(user)
    user_id = get_auth_user_id(user)

    result = await db.execute(select(Workspace).where(Workspace.id == workspace_id))
    current = result.scalar_one()
    previous_slug = current.slug

    if body.slug is not None:
        taken = await db.execute(
            select(Workspace.id).where(Workspace.slug == body.slug, Workspace.id != workspace_id)
        )
        if taken.scalar_one_or_none():
            raise AppError.conflict("Workspace slug already taken")

    if body.name is not None:
        current.name = body.name
    if body.slug is not None:
        current.slug = body.slug
    if body.default_routing_strategy is not None:
        current.default_routing_strategy = body.default_routing_strategy
    if body.semantic_cache_enabled is not None:
        current.semantic_cache_enabled = body.semantic_cache_enabled
    if body.cache_threshold is not None:
        current.cache_threshold = body.cache_threshold
    if body.allowed_providers is not None:
        current.allowed_providers = body.allowed_providers
    if body.requests_per_minute is not None:
        current.requests_per_minute = body.requests_per_minute
    if body.requests_per_day is not None:
        current.requests_per_day = body.requests_per_day
    if body.tokens_per_minute is not None:
        current.tokens_per_minute = body.tokens_per_minute

    slug_changed = body.slug is not None and body.slug != previous_slug
    audit_metadata = body.model_dump(exclude_unset=True, by_alias=True)
    if slug_changed and body.slug:
        audit_metadata["previousSlug"] = previous_slug
        audit_metadata["newSlug"] = body.slug

    db.add(
        AuditLog(
            user_id=user_id,
            workspace_id=workspace_id,
            action=AuditAction.SETTINGS_UPDATED.value,
            metadata_=audit_metadata,
        )
    )

    if slug_changed and body.slug:
        db.add(
            Notification(
                workspace_id=workspace_id,
                type="WORKSPACE_SLUG_CHANGED",
                title="Workspace slug updated",
                body=f"Slug changed from @{previous_slug} to @{body.slug}. Update IdP ACS URLs if SSO is configured.",
                metadata_={"previousSlug": previous_slug, "newSlug": body.slug},
            )
        )

    await db.flush()
    await sync_rate_limit_record(db, workspace_id)
    return _ok(_workspace_to_dict(current))


@router.post("/current/budgets", status_code=status.HTTP_201_CREATED, dependencies=[Depends(load_workspace_role), Depends(can_admin)])
async def create_budget(
    body: CreateBudgetRequest,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    workspace_id = get_auth_workspace_id(user)
    await enforce_budget_limit(db, workspace_id, body.limit_usd)

    now = datetime.now(timezone.utc)
    period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if period_start.month == 12:
        period_end = period_start.replace(year=period_start.year + 1, month=1, day=1) - timedelta(days=1)
    else:
        period_end = period_start.replace(month=period_start.month + 1, day=1) - timedelta(days=1)

    budget = Budget(
        workspace_id=workspace_id,
        name=body.name,
        limit_usd=body.limit_usd,
        period=body.period,
        period_start_at=period_start,
        period_end_at=period_end,
        alert_at_80=body.alert_at_80,
        alert_at_90=body.alert_at_90,
        block_at_100=body.block_at_100,
    )
    db.add(budget)
    await db.flush()

    return _ok(
        {
            "id": budget.id,
            "name": budget.name,
            "limitUsd": budget.limit_usd,
            "period": budget.period,
            "periodStartAt": budget.period_start_at.isoformat(),
            "periodEndAt": budget.period_end_at.isoformat(),
            "alertAt80": budget.alert_at_80,
            "alertAt90": budget.alert_at_90,
            "blockAt100": budget.block_at_100,
        },
        status.HTTP_201_CREATED,
    )


@router.get("/current/budgets", dependencies=[Depends(load_workspace_role)])
async def list_budgets(
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(Budget)
        .options(selectinload(Budget.budget_alerts))
        .where(Budget.workspace_id == user.workspace_id, Budget.is_active.is_(True))
    )
    budgets = result.scalars().all()
    data = []
    for budget in budgets:
        alerts = [a for a in budget.budget_alerts if a.status in ("PENDING", "SENT")]
        alerts.sort(key=lambda a: a.created_at, reverse=True)
        data.append(
            {
                "id": budget.id,
                "name": budget.name,
                "limitUsd": budget.limit_usd,
                "period": budget.period,
                "currentSpend": budget.current_spend,
                "budgetAlerts": [
                    {
                        "id": a.id,
                        "severity": a.severity,
                        "status": a.status,
                        "createdAt": a.created_at.isoformat() if a.created_at else None,
                    }
                    for a in alerts[:5]
                ],
            }
        )
    return _ok(data)


@router.get("/current/rate-limits", dependencies=[Depends(load_workspace_role)])
async def get_rate_limits(
    user: Annotated[AuthPayload, Depends(require_auth)],
    repo: Annotated[GatewayRepository, Depends(get_repository)],
):
    status_data = await rate_limiter_engine.get_status(user.workspace_id, repo)
    return _ok(status_data)


@router.get("/current/health", dependencies=[Depends(load_workspace_role)])
async def get_provider_health(db: Annotated[AsyncSession, Depends(get_db)]):
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=5)
    result = await db.execute(
        select(ProviderHealth)
        .options(selectinload(ProviderHealth.model))
        .where(ProviderHealth.checked_at >= cutoff)
        .order_by(ProviderHealth.checked_at.desc())
    )
    rows = result.scalars().all()
    seen: set[str] = set()
    latest = []
    for row in rows:
        if row.model_registry_id in seen:
            continue
        seen.add(row.model_registry_id)
        latest.append(
            {
                "id": row.id,
                "status": row.status,
                "latencyMs": row.latency_ms,
                "checkedAt": row.checked_at.isoformat() if row.checked_at else None,
                "model": {
                    "provider": row.model.provider,
                    "modelId": row.model.model_id,
                },
            }
        )
    return _ok(latest)


@router.get("/current/audit-logs", dependencies=[Depends(load_workspace_role)])
async def list_audit_logs(
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(1, ge=1),
    limit: int = Query(30, ge=1, le=100),
):
    workspace_id = get_auth_workspace_id(user)
    skip = (page - 1) * limit

    total = await db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.workspace_id == workspace_id))
    result = await db.execute(
        select(AuditLog)
        .options(selectinload(AuditLog.user))
        .where(AuditLog.workspace_id == workspace_id)
        .order_by(AuditLog.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    rows = result.scalars().all()

    data = [
        {
            "id": r.id,
            "action": r.action,
            "resourceType": r.resource_type,
            "resourceId": r.resource_id,
            "metadata": r.metadata_,
            "ipAddress": r.ip_address,
            "createdAt": r.created_at.isoformat() if r.created_at else None,
            "user": {
                "id": r.user.id,
                "name": r.user.name,
                "email": r.user.email,
            }
            if r.user
            else None,
        }
        for r in rows
    ]

    total = total or 0
    return _ok(
        {
            "data": data,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit if limit else 0,
                "hasNext": skip + limit < total,
                "hasPrev": page > 1,
            },
        }
    )


@router.get("/current/audit-logs/export", dependencies=[Depends(load_workspace_role)])
async def export_audit_logs(
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
    format: str = Query("json"),
    limit: int = Query(5000, ge=1, le=10000),
    from_date: str | None = Query(None, alias="from"),
    to_date: str | None = Query(None, alias="to"),
):
    workspace_id = get_auth_workspace_id(user)
    now = datetime.now(timezone.utc)
    try:
        from_dt = datetime.fromisoformat(from_date.replace("Z", "+00:00")) if from_date else now - timedelta(days=30)
        to_dt = datetime.fromisoformat(to_date.replace("Z", "+00:00")) if to_date else now
    except ValueError:
        return JSONResponse(
            status_code=400,
            content={
                "success": False,
                "error": {"code": "INVALID_DATE", "message": "Invalid from/to date"},
            },
        )

    result = await db.execute(
        select(AuditLog)
        .options(selectinload(AuditLog.user))
        .where(
            AuditLog.workspace_id == workspace_id,
            AuditLog.created_at >= from_dt,
            AuditLog.created_at <= to_dt,
        )
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
    )
    rows = result.scalars().all()

    if format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(
            [
                "id",
                "action",
                "resourceType",
                "resourceId",
                "userName",
                "userEmail",
                "ipAddress",
                "previousSlug",
                "newSlug",
                "metadata",
                "createdAt",
            ]
        )
        for row in rows:
            slug_cols = audit_slug_columns(row.metadata_)
            writer.writerow(
                [
                    row.id,
                    row.action,
                    row.resource_type or "",
                    row.resource_id or "",
                    row.user.name if row.user else "",
                    row.user.email if row.user else "",
                    row.ip_address or "",
                    slug_cols["previousSlug"],
                    slug_cols["newSlug"],
                    json.dumps(row.metadata_) if row.metadata_ else "",
                    row.created_at.isoformat() if row.created_at else "",
                ]
            )
        filename = f"smartroute-audit-{from_dt.date().isoformat()}.csv"
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
                    "action": r.action,
                    "metadata": r.metadata_,
                    "createdAt": r.created_at.isoformat() if r.created_at else None,
                }
                for r in rows
            ],
            "meta": {
                "count": len(rows),
                "from": from_dt.isoformat(),
                "to": to_dt.isoformat(),
                "limit": limit,
            },
        },
    )
