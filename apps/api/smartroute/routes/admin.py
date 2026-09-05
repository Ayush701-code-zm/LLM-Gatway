"""Admin routes — /api/v1/admin."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from smartroute.db import get_db
from smartroute.errors import AppError
from smartroute.lib.sync_rate_limit import sync_rate_limit_record
from smartroute.middleware.auth import require_auth, require_super_admin
from smartroute.models import GatewayRequest, User, Workspace

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_auth), Depends(require_super_admin)])


class PatchWorkspaceRequest(BaseModel):
    plan: Literal["FREE", "PRO", "ENTERPRISE"] | None = None
    isActive: bool | None = None


class PatchUserRequest(BaseModel):
    role: Literal["SUPER_ADMIN", "USER"]


from smartroute.lib.responses import success_response


def _ok(data: object, status_code: int = status.HTTP_200_OK, **extra) -> Response:
    return success_response(data, status_code=status_code, **extra)


@router.get("/overview")
async def admin_overview(db: Annotated[AsyncSession, Depends(get_db)]):
    since = datetime.now(UTC) - timedelta(hours=24)
    users = await db.scalar(select(func.count()).select_from(User).where(User.deleted_at.is_(None)))
    workspaces = await db.scalar(select(func.count()).select_from(Workspace).where(Workspace.deleted_at.is_(None)))
    requests_today = await db.scalar(
        select(func.count()).select_from(GatewayRequest).where(GatewayRequest.created_at >= since)
    )
    active_workspaces = await db.scalar(
        select(func.count()).select_from(Workspace).where(Workspace.deleted_at.is_(None), Workspace.is_active.is_(True))
    )
    return _ok(
        {
            "users": users or 0,
            "workspaces": workspaces or 0,
            "activeWorkspaces": active_workspaces or 0,
            "requestsToday": requests_today or 0,
        }
    )


@router.get("/workspaces")
async def admin_workspaces(
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=50),
):
    skip = (page - 1) * limit
    total = await db.scalar(select(func.count()).select_from(Workspace).where(Workspace.deleted_at.is_(None)))
    result = await db.execute(
        select(Workspace)
        .options(selectinload(Workspace.members), selectinload(Workspace.api_keys))
        .where(Workspace.deleted_at.is_(None))
        .order_by(Workspace.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    data = [
        {
            "id": w.id,
            "name": w.name,
            "slug": w.slug,
            "plan": w.plan,
            "isActive": w.is_active,
            "createdAt": w.created_at.isoformat() if w.created_at else None,
            "_count": {"members": len(w.members), "requests": 0},
        }
        for w in result.scalars().all()
    ]
    total = total or 0
    return _ok(
        data,
        pagination={
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": (total + limit - 1) // limit if limit else 0,
            "hasNext": skip + limit < total,
            "hasPrev": page > 1,
        },
    )


@router.patch("/workspaces/{workspace_id}")
async def patch_workspace(
    workspace_id: str,
    body: PatchWorkspaceRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(Workspace).where(Workspace.id == workspace_id, Workspace.deleted_at.is_(None))
    )
    workspace = result.scalar_one_or_none()
    if not workspace:
        raise AppError.not_found("Workspace not found")

    if body.plan is not None:
        workspace.plan = body.plan
    if body.isActive is not None:
        workspace.is_active = body.isActive
    await db.flush()

    if body.plan is not None:
        await sync_rate_limit_record(db, workspace.id)

    return _ok(
        {
            "id": workspace.id,
            "name": workspace.name,
            "slug": workspace.slug,
            "plan": workspace.plan,
            "isActive": workspace.is_active,
        }
    )


@router.get("/users")
async def admin_users(
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=50),
):
    skip = (page - 1) * limit
    total = await db.scalar(select(func.count()).select_from(User).where(User.deleted_at.is_(None)))
    result = await db.execute(
        select(User)
        .options(selectinload(User.workspace_memberships))
        .where(User.deleted_at.is_(None))
        .order_by(User.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    data = [
        {
            "id": u.id,
            "email": u.email,
            "name": u.name,
            "role": u.role,
            "emailVerified": u.email_verified,
            "createdAt": u.created_at.isoformat() if u.created_at else None,
            "lastLoginAt": u.last_login_at.isoformat() if u.last_login_at else None,
            "_count": {"workspaceMemberships": len(u.workspace_memberships)},
        }
        for u in result.scalars().all()
    ]
    total = total or 0
    return _ok(
        data,
        pagination={
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": (total + limit - 1) // limit if limit else 0,
            "hasNext": skip + limit < total,
            "hasPrev": page > 1,
        },
    )


@router.patch("/users/{user_id}")
async def patch_user(
    user_id: str,
    body: PatchUserRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(User).where(User.id == user_id, User.deleted_at.is_(None)))
    user = result.scalar_one_or_none()
    if not user:
        raise AppError.not_found("User not found")

    user.role = body.role
    await db.flush()
    return _ok(
        {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role,
            "emailVerified": user.email_verified,
        }
    )
