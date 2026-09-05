"""Keeps the rate_limits table in sync with workspace plan + overrides."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smartroute.lib.constants import PLAN_LIMITS
from smartroute.models import RateLimit, Workspace


async def sync_rate_limit_record(db: AsyncSession, workspace_id: str) -> None:
    result = await db.execute(
        select(Workspace).where(Workspace.id == workspace_id)
    )
    workspace = result.scalar_one()

    plan_limits = PLAN_LIMITS.get(workspace.plan, PLAN_LIMITS["FREE"])
    requests_per_minute = workspace.requests_per_minute or plan_limits["requestsPerMinute"]
    requests_per_day = workspace.requests_per_day or plan_limits["requestsPerDay"]
    tokens_per_minute = workspace.tokens_per_minute or plan_limits["tokensPerMinute"]

    existing = await db.execute(
        select(RateLimit).where(RateLimit.workspace_id == workspace_id)
    )
    rate_limit = existing.scalar_one_or_none()

    if rate_limit is None:
        rate_limit = RateLimit(
            workspace_id=workspace_id,
            plan=workspace.plan,
            requests_per_minute=requests_per_minute,
            requests_per_hour=plan_limits["requestsPerHour"],
            requests_per_day=requests_per_day,
            tokens_per_minute=tokens_per_minute,
            tokens_per_day=plan_limits["tokensPerDay"],
        )
        db.add(rate_limit)
    else:
        rate_limit.plan = workspace.plan
        rate_limit.requests_per_minute = requests_per_minute
        rate_limit.requests_per_hour = plan_limits["requestsPerHour"]
        rate_limit.requests_per_day = requests_per_day
        rate_limit.tokens_per_minute = tokens_per_minute
        rate_limit.tokens_per_day = plan_limits["tokensPerDay"]

    await db.flush()
