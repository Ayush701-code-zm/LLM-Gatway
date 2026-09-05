"""Webhook management routes — /api/v1/webhooks."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import Response
from pydantic import BaseModel, Field, HttpUrl, field_validator

from smartroute.db import get_db
from smartroute.errors import AppError
from smartroute.middleware.auth import (
    AuthPayload,
    can_admin,
    get_auth_workspace_id,
    load_workspace_role,
    require_auth,
)
from smartroute.queues import enqueue_webhook_delivery
from smartroute.services.webhook_service import WebhookService
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/webhooks", tags=["webhooks"])

VALID_EVENTS = {
    "budget.warning",
    "budget.critical",
    "budget.exceeded",
    "provider.down",
    "provider.recovered",
    "circuit_breaker.open",
    "circuit_breaker.closed",
    "rate_limit.exceeded",
    "anomaly.detected",
}


class CreateWebhookRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    url: HttpUrl
    events: list[str] = Field(default_factory=list)

    @field_validator("url")
    @classmethod
    def validate_https(cls, value: HttpUrl) -> HttpUrl:
        url = str(value)
        if not url.startswith("https://") and not url.startswith("http://localhost"):
            raise ValueError("Webhook URL must use HTTPS (or http://localhost for testing)")
        return value

    @field_validator("events")
    @classmethod
    def validate_events(cls, events: list[str]) -> list[str]:
        for event in events:
            if event not in VALID_EVENTS:
                raise ValueError(f"Invalid event: {event}")
        return events


class PatchWebhookRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    url: HttpUrl | None = None
    events: list[str] | None = None
    status: Literal["ACTIVE", "INACTIVE"] | None = None

    @field_validator("url")
    @classmethod
    def validate_https(cls, value: HttpUrl | None) -> HttpUrl | None:
        if value is None:
            return value
        url = str(value)
        if not url.startswith("https://") and not url.startswith("http://localhost"):
            raise ValueError("Webhook URL must use HTTPS (or http://localhost for testing)")
        return value


from smartroute.lib.responses import success_response


def _ok(data: object, status_code: int = status.HTTP_200_OK, **extra) -> Response:
    return success_response(data, status_code=status_code, **extra)


@router.get("", dependencies=[Depends(require_auth), Depends(load_workspace_role)])
async def list_webhooks(
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    data = await WebhookService(db).list(get_auth_workspace_id(user))
    return _ok(data)


@router.post("", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_auth), Depends(load_workspace_role), Depends(can_admin)])
async def create_webhook(
    body: CreateWebhookRequest,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    webhook = await WebhookService(db).create(
        get_auth_workspace_id(user),
        {"name": body.name, "url": str(body.url), "events": body.events},
    )
    return _ok(
        webhook,
        status.HTTP_201_CREATED,
        meta={
            "signingSecretNote": (
                "Store this signing secret securely — it will not be shown again. "
                "Use it to verify X-SmartRoute-Signature-256 on incoming deliveries."
            )
        },
    )


@router.get("/{webhook_id}", dependencies=[Depends(require_auth), Depends(load_workspace_role)])
async def get_webhook(
    webhook_id: str,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    data = await WebhookService(db).get(webhook_id, get_auth_workspace_id(user))
    return _ok(data)


@router.patch("/{webhook_id}", dependencies=[Depends(require_auth), Depends(load_workspace_role), Depends(can_admin)])
async def patch_webhook(
    webhook_id: str,
    body: PatchWebhookRequest,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    payload = body.model_dump(exclude_unset=True)
    if "url" in payload and payload["url"] is not None:
        payload["url"] = str(payload["url"])
    data = await WebhookService(db).update(webhook_id, get_auth_workspace_id(user), payload)
    return _ok(data)


@router.delete("/{webhook_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_auth), Depends(load_workspace_role), Depends(can_admin)])
async def delete_webhook(
    webhook_id: str,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await WebhookService(db).delete(webhook_id, get_auth_workspace_id(user))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{webhook_id}/rotate-secret", dependencies=[Depends(require_auth), Depends(load_workspace_role), Depends(can_admin)])
async def rotate_secret(
    webhook_id: str,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    data = await WebhookService(db).rotate_secret(webhook_id, get_auth_workspace_id(user))
    return _ok(
        data,
        meta={"signingSecretNote": "Update your receiver to use the new secret immediately."},
    )


@router.get("/{webhook_id}/deliveries", dependencies=[Depends(require_auth), Depends(load_workspace_role)])
async def list_deliveries(
    webhook_id: str,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int = Query(50, ge=1, le=100),
):
    data = await WebhookService(db).get_deliveries(webhook_id, get_auth_workspace_id(user), limit)
    return _ok(data)


@router.post("/{webhook_id}/test", status_code=status.HTTP_202_ACCEPTED, dependencies=[Depends(require_auth), Depends(load_workspace_role), Depends(can_admin)])
async def test_webhook(
    webhook_id: str,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    workspace_id = get_auth_workspace_id(user)
    service = WebhookService(db)
    webhook = await service.get(webhook_id, workspace_id)
    if webhook["status"] != "ACTIVE":
        raise AppError.bad_request("Cannot test an inactive webhook. Enable it first.")

    delivery_ids = await service.dispatch(
        workspace_id,
        "budget.warning",
        {
            "test": True,
            "message": "This is a test delivery from SmartRoute AI.",
            "timestamp": datetime.now(UTC).isoformat(),
        },
    )
    if not delivery_ids:
        raise AppError.internal("Could not create test delivery")

    await enqueue_webhook_delivery(delivery_ids[0], 0)
    return _ok(
        {"deliveryId": delivery_ids[0], "message": "Test delivery queued. Check /deliveries for the result."},
        status.HTTP_202_ACCEPTED,
    )
