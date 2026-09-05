"""Plan limit enforcement."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from smartroute.errors import AppError
from smartroute.lib.constants import PLAN_LIMITS
from smartroute.models import ApiKey, Workspace, WorkspaceMember


async def get_workspace_plan(db: AsyncSession, workspace_id: str) -> str:
    result = await db.execute(select(Workspace.plan).where(Workspace.id == workspace_id))
    plan = result.scalar_one_or_none()
    return plan or "FREE"


async def enforce_api_key_limit(db: AsyncSession, workspace_id: str) -> None:
    plan = await get_workspace_plan(db, workspace_id)
    limit = PLAN_LIMITS[plan]["maxApiKeys"]
    if limit < 0:
        return

    result = await db.execute(
        select(func.count())
        .select_from(ApiKey)
        .where(ApiKey.workspace_id == workspace_id, ApiKey.status != "REVOKED")
    )
    count = result.scalar_one()
    if count >= limit:
        raise AppError.forbidden(
            f"API key limit reached for {plan} plan ({limit}). Upgrade to create more keys.",
        )


async def enforce_member_limit(db: AsyncSession, workspace_id: str) -> None:
    plan = await get_workspace_plan(db, workspace_id)
    limit = PLAN_LIMITS[plan]["maxWorkspaceMembers"]
    if limit < 0:
        return

    result = await db.execute(
        select(func.count())
        .select_from(WorkspaceMember)
        .where(WorkspaceMember.workspace_id == workspace_id)
    )
    count = result.scalar_one()
    if count >= limit:
        raise AppError.forbidden(
            f"Member limit reached for {plan} plan ({limit}). Upgrade to invite more members.",
        )


async def enforce_budget_limit(db: AsyncSession, workspace_id: str, limit_usd: float) -> None:
    plan = await get_workspace_plan(db, workspace_id)
    max_budget = PLAN_LIMITS[plan]["budgetLimitUsd"]
    if max_budget < 0:
        return

    if limit_usd > max_budget:
        raise AppError.forbidden(
            f"Budget limit of ${max_budget} exceeded for {plan} plan. Upgrade for higher budgets.",
        )
