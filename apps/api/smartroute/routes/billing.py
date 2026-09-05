"""Billing routes — /api/v1/billing."""

from __future__ import annotations

from typing import Annotated, Literal

import stripe
from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smartroute.config import settings
from smartroute.config.logger import logger
from smartroute.db import get_db
from smartroute.errors import AppError
from smartroute.lib.stripe_webhook import handle_stripe_event
from smartroute.middleware.auth import (
    AuthPayload,
    can_owner,
    get_auth_user_id,
    get_auth_workspace_id,
    load_workspace_role,
    require_auth,
)
from smartroute.models import User, Workspace

router = APIRouter(prefix="/billing", tags=["billing"])


class CheckoutRequest(BaseModel):
    plan: Literal["PRO", "ENTERPRISE"]


from smartroute.lib.responses import success_response


def _ok(data: object, status_code: int = status.HTTP_200_OK) -> Response:
    return success_response(data, status_code=status_code)


def _get_stripe():
    if not settings.STRIPE_SECRET_KEY:
        raise AppError.bad_request("Stripe is not configured")
    stripe.api_key = settings.STRIPE_SECRET_KEY
    return stripe


@router.get("/plans")
async def list_plans():
    return _ok(
        [
            {"id": "FREE", "name": "Free", "priceUsd": 0, "limits": {"rpm": 10, "apiKeys": 2, "members": 1}},
            {"id": "PRO", "name": "Pro", "priceUsd": 49, "limits": {"rpm": 60, "apiKeys": 20, "members": 10}},
            {"id": "ENTERPRISE", "name": "Enterprise", "priceUsd": 499, "limits": {"rpm": 1000, "apiKeys": -1, "members": -1}},
        ]
    )


@router.get("/status", dependencies=[Depends(require_auth), Depends(load_workspace_role)])
async def billing_status(
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(Workspace.plan, Workspace.stripe_customer_id).where(Workspace.id == user.workspace_id)
    )
    row = result.one()
    return _ok(
        {
            "currentPlan": row.plan,
            "stripeConfigured": bool(settings.STRIPE_SECRET_KEY and settings.STRIPE_PRICE_PRO),
            "hasBillingAccount": bool(row.stripe_customer_id),
        }
    )


@router.post("/checkout", dependencies=[Depends(require_auth), Depends(load_workspace_role), Depends(can_owner)])
async def create_checkout(
    body: CheckoutRequest,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    workspace_id = get_auth_workspace_id(user)
    user_id = get_auth_user_id(user)
    price_id = settings.STRIPE_PRICE_PRO if body.plan == "PRO" else settings.STRIPE_PRICE_ENTERPRISE
    if not price_id:
        raise AppError.bad_request(f"Stripe price not configured for {body.plan}")

    user_row = await db.get(User, user_id)
    if not user_row:
        raise AppError.not_found("User not found")
    workspace = await db.get(Workspace, workspace_id)
    if not workspace:
        raise AppError.not_found("Workspace not found")

    client = _get_stripe()
    customer_id = workspace.stripe_customer_id
    if not customer_id:
        customer = client.Customer.create(
            email=user_row.email,
            name=workspace.name,
            metadata={"workspaceId": workspace_id},
        )
        customer_id = customer.id
        workspace.stripe_customer_id = customer_id
        await db.flush()

    web_base = settings.web_base_url
    session = client.checkout.Session.create(
        mode="subscription",
        customer=customer_id,
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=f"{web_base}/settings?billing=success",
        cancel_url=f"{web_base}/settings?billing=cancelled",
        metadata={"workspaceId": workspace_id, "plan": body.plan},
        subscription_data={"metadata": {"workspaceId": workspace_id, "plan": body.plan}},
    )
    return _ok({"url": session.url, "sessionId": session.id})


@router.post("/portal", dependencies=[Depends(require_auth), Depends(load_workspace_role), Depends(can_owner)])
async def create_portal(
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    workspace_id = get_auth_workspace_id(user)
    workspace = await db.get(Workspace, workspace_id)
    if not workspace or not workspace.stripe_customer_id:
        raise AppError.bad_request("No billing account found. Complete checkout first.")

    client = _get_stripe()
    session = client.billing_portal.Session.create(
        customer=workspace.stripe_customer_id,
        return_url=f"{settings.web_base_url}/settings",
    )
    return _ok({"url": session.url})


@router.post("/webhook")
async def stripe_webhook(request: Request, db: Annotated[AsyncSession, Depends(get_db)]):
    if not settings.STRIPE_WEBHOOK_SECRET:
        return JSONResponse(
            status_code=503,
            content={"success": False, "error": {"message": "Stripe webhook not configured"}},
        )

    payload = await request.body()
    sig = request.headers.get("stripe-signature")
    if not sig:
        return JSONResponse(status_code=400, content={"success": False, "error": {"message": "Missing signature"}})

    try:
        _get_stripe()
        event = stripe.Webhook.construct_event(payload, sig, settings.STRIPE_WEBHOOK_SECRET)
        event_dict = event.to_dict() if hasattr(event, "to_dict") else dict(event)
        await handle_stripe_event(db, event_dict)
        return JSONResponse(status_code=200, content={"received": True})
    except Exception as exc:
        logger.error("stripe_webhook_error", err=str(exc))
        return JSONResponse(status_code=400, content={"success": False, "error": {"message": str(exc)}})
