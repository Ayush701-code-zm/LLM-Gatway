"""Notification routes — /api/v1/notifications."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import Response
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from smartroute.db import get_db
from smartroute.errors import AppError
from smartroute.middleware.auth import (
    AuthPayload,
    get_auth_user_id,
    get_auth_workspace_id,
    require_auth,
)
from smartroute.models import AuditAction, AuditLog, Notification

router = APIRouter(prefix="/notifications", tags=["notifications"], dependencies=[Depends(require_auth)])


from smartroute.lib.responses import success_response


def _ok(data: object, status_code: int = status.HTTP_200_OK) -> Response:
    return success_response(data, status_code=status_code)


@router.get("")
async def list_notifications(
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(1, ge=1),
    limit: int = Query(30, ge=1, le=100),
    unread: bool = Query(False),
):
    workspace_id = get_auth_workspace_id(user)
    skip = (page - 1) * limit
    filters = [Notification.workspace_id == workspace_id]
    if unread:
        filters.append(Notification.read_at.is_(None))

    total = await db.scalar(select(func.count()).select_from(Notification).where(*filters))
    result = await db.execute(
        select(Notification)
        .where(*filters)
        .order_by(Notification.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    rows = [
        {
            "id": n.id,
            "type": n.type,
            "title": n.title,
            "body": n.body,
            "metadata": n.metadata_,
            "readAt": n.read_at.isoformat() if n.read_at else None,
            "createdAt": n.created_at.isoformat() if n.created_at else None,
        }
        for n in result.scalars().all()
    ]
    total = total or 0
    return _ok(
        {
            "data": rows,
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


@router.get("/unread-count")
async def unread_count(
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    count = await db.scalar(
        select(func.count()).select_from(Notification).where(
            Notification.workspace_id == get_auth_workspace_id(user),
            Notification.read_at.is_(None),
        )
    )
    return _ok({"count": count or 0})


@router.patch("/{notification_id}/read")
async def mark_read(
    notification_id: str,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    workspace_id = get_auth_workspace_id(user)
    result = await db.execute(
        select(Notification).where(Notification.id == notification_id, Notification.workspace_id == workspace_id)
    )
    existing = result.scalar_one_or_none()
    if not existing:
        raise AppError.not_found(f"Notification {notification_id} not found")

    existing.read_at = datetime.now(UTC)
    await db.flush()
    return _ok(
        {
            "id": existing.id,
            "type": existing.type,
            "title": existing.title,
            "body": existing.body,
            "readAt": existing.read_at.isoformat(),
            "createdAt": existing.created_at.isoformat() if existing.created_at else None,
        }
    )


@router.post("/read-all")
async def mark_all_read(
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    workspace_id = get_auth_workspace_id(user)
    user_id = get_auth_user_id(user)
    now = datetime.now(UTC)

    result = await db.execute(
        update(Notification)
        .where(Notification.workspace_id == workspace_id, Notification.read_at.is_(None))
        .values(read_at=now)
    )
    updated = result.rowcount or 0

    db.add(
        AuditLog(
            workspace_id=workspace_id,
            user_id=user_id,
            action=AuditAction.SETTINGS_UPDATED.value,
            resource_type="Notification",
            metadata_={"action": "mark_all_read", "count": updated},
        )
    )
    await db.flush()
    return _ok({"updated": updated})
