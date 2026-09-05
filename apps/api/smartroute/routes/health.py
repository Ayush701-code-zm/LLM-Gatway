"""Infrastructure health routes — /health."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse
from sqlalchemy import text

from smartroute.config import settings
from smartroute.db import engine
from smartroute.redis_client import get_redis

router = APIRouter(prefix="/health", tags=["health"])


@router.get("")
async def health_check():
    checks: dict[str, dict] = {}

    db_start = datetime.now(UTC)
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        checks["database"] = {"status": "healthy", "latencyMs": int((datetime.now(UTC) - db_start).total_seconds() * 1000)}
    except Exception as exc:
        checks["database"] = {"status": "unhealthy", "error": str(exc)}

    redis_start = datetime.now(UTC)
    try:
        await get_redis().ping()
        checks["redis"] = {"status": "healthy", "latencyMs": int((datetime.now(UTC) - redis_start).total_seconds() * 1000)}
    except Exception as exc:
        checks["redis"] = {"status": "unhealthy", "error": str(exc)}

    all_healthy = all(item["status"] == "healthy" for item in checks.values())
    return JSONResponse(
        status_code=status.HTTP_200_OK if all_healthy else status.HTTP_503_SERVICE_UNAVAILABLE,
        content={
            "status": "healthy" if all_healthy else "degraded",
            "version": settings.APP_VERSION,
            "environment": settings.NODE_ENV,
            "timestamp": datetime.now(UTC).isoformat(),
            "checks": checks,
        },
    )


@router.get("/live")
async def liveness():
    return JSONResponse(status_code=200, content={"status": "alive"})


@router.get("/ready")
async def readiness():
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return JSONResponse(status_code=200, content={"status": "ready"})
    except Exception:
        return JSONResponse(status_code=503, content={"status": "not ready", "reason": "database unavailable"})
