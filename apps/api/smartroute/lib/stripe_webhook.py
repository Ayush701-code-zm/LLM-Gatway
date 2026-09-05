"""Stripe webhook event handlers."""

from __future__ import annotations

from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smartroute.config import settings
from smartroute.config.logger import logger
from smartroute.lib.sync_rate_limit import sync_rate_limit_record
from smartroute.models import Notification, Workspace
from smartroute.redis_client import get_redis

PlanTier = Literal["FREE", "PRO", "ENTERPRISE"]


def plan_from_price_id(price_id: str | None) -> PlanTier | None:
    if not price_id:
        return None
    if price_id == settings.STRIPE_PRICE_PRO:
        return "PRO"
    if price_id == settings.STRIPE_PRICE_ENTERPRISE:
        return "ENTERPRISE"
    return None


async def is_duplicate_event(event_id: str) -> bool:
    redis = get_redis()
    key = f"stripe:event:{event_id}"
    inserted = await redis.set(key, b"1", ex=7 * 24 * 60 * 60, nx=True)
    return inserted is None


async def apply_workspace_plan(
    db: AsyncSession,
    workspace_id: str,
    plan: PlanTier,
    customer_id: str | None = None,
) -> None:
    result = await db.execute(select(Workspace).where(Workspace.id == workspace_id))
    workspace = result.scalar_one()
    workspace.plan = plan
    if customer_id:
        workspace.stripe_customer_id = customer_id
    await db.flush()
    await sync_rate_limit_record(db, workspace_id)


async def handle_stripe_event(db: AsyncSession, event: dict) -> None:
    event_id = event.get("id", "")
    event_type = event.get("type", "")
    data_object = event.get("data", {}).get("object", {})

    if event_id and await is_duplicate_event(event_id):
        logger.info("stripe_event_duplicate", event_id=event_id, type=event_type)
        return

    if event_type == "checkout.session.completed":
        metadata = data_object.get("metadata") or {}
        workspace_id = metadata.get("workspaceId")
        plan = metadata.get("plan")
        customer = data_object.get("customer")
        customer_id = customer if isinstance(customer, str) else (customer or {}).get("id")

        if workspace_id and plan and plan != "FREE":
            await apply_workspace_plan(db, workspace_id, plan, customer_id)
            logger.info("stripe_checkout_completed", workspace_id=workspace_id, plan=plan)

    elif event_type == "customer.subscription.updated":
        metadata = data_object.get("metadata") or {}
        workspace_id = metadata.get("workspaceId")
        if not workspace_id:
            return

        status = data_object.get("status")
        if status in ("canceled", "unpaid", "incomplete_expired"):
            await apply_workspace_plan(db, workspace_id, "FREE")
            logger.info("stripe_subscription_downgraded", workspace_id=workspace_id, status=status)
            return

        items = (data_object.get("items") or {}).get("data") or []
        price_id = (items[0].get("price") or {}).get("id") if items else None
        plan = metadata.get("plan") or plan_from_price_id(price_id)
        if plan and plan != "FREE":
            await apply_workspace_plan(db, workspace_id, plan)
            logger.info("stripe_subscription_synced", workspace_id=workspace_id, plan=plan)

    elif event_type == "customer.subscription.deleted":
        metadata = data_object.get("metadata") or {}
        workspace_id = metadata.get("workspaceId")
        if workspace_id:
            await apply_workspace_plan(db, workspace_id, "FREE")
            logger.info("stripe_subscription_deleted", workspace_id=workspace_id)

    elif event_type == "invoice.payment_failed":
        customer = data_object.get("customer")
        customer_id = customer if isinstance(customer, str) else (customer or {}).get("id")
        subscription_details = data_object.get("subscription_details") or {}
        workspace_id = (subscription_details.get("metadata") or {}).get("workspaceId")

        if not workspace_id and customer_id:
            result = await db.execute(
                select(Workspace.id).where(Workspace.stripe_customer_id == customer_id)
            )
            workspace_id = result.scalar_one_or_none()

        if workspace_id:
            db.add(
                Notification(
                    workspace_id=workspace_id,
                    type="BUDGET_CRITICAL",
                    title="Payment failed",
                    body="Your subscription payment failed. Update your billing details to avoid service interruption.",
                    metadata_={"source": "stripe", "eventId": event_id},
                )
            )
            logger.warning("stripe_payment_failed", workspace_id=workspace_id)

    else:
        logger.debug("stripe_event_unhandled", type=event_type)
