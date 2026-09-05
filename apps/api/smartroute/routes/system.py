"""System routes — /api/v1/system."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smartroute.db import get_db
from smartroute.middleware.auth import can_admin, load_workspace_role, require_auth
from smartroute.models import HealthCheck

router = APIRouter(
    prefix="/system",
    tags=["system"],
    dependencies=[Depends(require_auth), Depends(load_workspace_role), Depends(can_admin)],
)


from smartroute.lib.responses import success_response


def _ok(data: object) -> Response:
    return success_response(data)


@router.get("/health")
async def system_health(db: AsyncSession = Depends(get_db)):
    since = datetime.now(UTC) - timedelta(hours=24)
    result = await db.execute(
        select(HealthCheck)
        .where(HealthCheck.checked_at >= since)
        .order_by(HealthCheck.checked_at.desc())
        .limit(100)
    )
    checks = result.scalars().all()
    latest_by_service: dict[str, HealthCheck] = {}
    for check in checks:
        if check.service not in latest_by_service:
            latest_by_service[check.service] = check

    return _ok(
        [
            {
                "id": c.id,
                "service": c.service,
                "status": c.status,
                "latencyMs": c.latency_ms,
                "details": c.details,
                "checkedAt": c.checked_at.isoformat() if c.checked_at else None,
            }
            for c in latest_by_service.values()
        ]
    )
