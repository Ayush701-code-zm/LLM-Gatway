"""Webhook delivery service."""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
from typing import Literal

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from smartroute.config.logger import logger
from smartroute.errors import AppError
from smartroute.lib.crypto import encrypt_secret, resolve_secret
from smartroute.models import Webhook, WebhookDelivery

WebhookEvent = Literal[
    "budget.warning",
    "budget.critical",
    "budget.exceeded",
    "provider.down",
    "provider.recovered",
    "circuit_breaker.open",
    "circuit_breaker.closed",
    "rate_limit.exceeded",
    "anomaly.detected",
]

MAX_FAILURES = 3
RETRY_DELAYS_MS = (0, 60_000, 300_000)


class WebhookService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    @staticmethod
    def generate_secret() -> str:
        return f"whs_{secrets.token_hex(24)}"

    @staticmethod
    def _sign(secret: str, payload: str, timestamp: int) -> str:
        data = f"t={timestamp}.{payload}"
        digest = hmac.new(secret.encode(), data.encode(), hashlib.sha256).hexdigest()
        return f"v1={digest}"

    async def create(self, workspace_id: str, data: dict) -> dict:
        secret = self.generate_secret()
        webhook = Webhook(
            workspace_id=workspace_id,
            name=data["name"],
            url=data["url"],
            signing_secret=encrypt_secret(secret),
            events=data.get("events") or [],
        )
        self.db.add(webhook)
        await self.db.flush()
        logger.info("webhook_created", webhook_id=webhook.id, workspace_id=workspace_id)
        return {
            "id": webhook.id,
            "name": webhook.name,
            "url": webhook.url,
            "events": webhook.events,
            "status": webhook.status,
            "createdAt": webhook.created_at.isoformat() if webhook.created_at else None,
            "signingSecret": secret,
        }

    async def list(self, workspace_id: str) -> list[dict]:
        result = await self.db.execute(
            select(Webhook)
            .where(Webhook.workspace_id == workspace_id)
            .order_by(Webhook.created_at.desc())
        )
        return [self._serialize_webhook(row) for row in result.scalars().all()]

    async def get(self, webhook_id: str, workspace_id: str) -> dict:
        webhook = await self._find_webhook(webhook_id, workspace_id)
        return self._serialize_webhook(webhook)

    async def update(self, webhook_id: str, workspace_id: str, data: dict) -> dict:
        webhook = await self._find_webhook(webhook_id, workspace_id, orm=True)
        if "name" in data and data["name"] is not None:
            webhook.name = data["name"]
        if "url" in data and data["url"] is not None:
            webhook.url = data["url"]
        if "events" in data and data["events"] is not None:
            webhook.events = data["events"]
        if "status" in data and data["status"] is not None:
            webhook.status = data["status"]
            if data["status"] == "ACTIVE":
                webhook.failure_count = 0
        await self.db.flush()
        return self._serialize_webhook(webhook)

    async def rotate_secret(self, webhook_id: str, workspace_id: str) -> dict:
        webhook = await self._find_webhook(webhook_id, workspace_id, orm=True)
        new_secret = self.generate_secret()
        webhook.signing_secret = encrypt_secret(new_secret)
        await self.db.flush()
        return {"id": webhook.id, "signingSecret": new_secret}

    async def delete(self, webhook_id: str, workspace_id: str) -> None:
        webhook = await self._find_webhook(webhook_id, workspace_id, orm=True)
        await self.db.delete(webhook)

    async def dispatch(self, workspace_id: str, event: str, data: dict) -> list[str]:
        result = await self.db.execute(
            select(Webhook.id).where(
                Webhook.workspace_id == workspace_id,
                Webhook.status == "ACTIVE",
            )
        )
        webhook_ids = [row[0] for row in result.all()]
        if not webhook_ids:
            return []

        subscribed: list[str] = []
        for webhook_id in webhook_ids:
            webhook = await self.db.get(Webhook, webhook_id)
            if not webhook:
                continue
            if webhook.events and event not in webhook.events:
                continue
            subscribed.append(webhook_id)

        if not subscribed:
            return []

        payload_base = {
            "event": event,
            "workspaceId": workspace_id,
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "data": data,
        }

        delivery_ids: list[str] = []
        for webhook_id in subscribed:
            delivery = WebhookDelivery(
                webhook_id=webhook_id,
                workspace_id=workspace_id,
                event=event,
                payload=payload_base,
                status="PENDING",
            )
            self.db.add(delivery)
            await self.db.flush()
            delivery_ids.append(delivery.id)

        logger.debug("webhook_deliveries_queued", event=event, workspace_id=workspace_id, count=len(delivery_ids))
        return delivery_ids

    async def deliver(self, delivery_id: str) -> None:
        result = await self.db.execute(
            select(WebhookDelivery)
            .options(selectinload(WebhookDelivery.webhook))
            .where(WebhookDelivery.id == delivery_id)
        )
        delivery = result.scalar_one_or_none()
        if not delivery:
            logger.warning("webhook_delivery_missing", delivery_id=delivery_id)
            return
        if delivery.status == "DELIVERED":
            return

        raw_body = json.dumps({**delivery.payload, "id": delivery_id}, separators=(",", ":"))
        timestamp = int(time.time() * 1000)
        secret = resolve_secret(delivery.webhook.signing_secret)
        signature = self._sign(secret, raw_body, timestamp)
        attempt = delivery.attempts + 1
        start = time.time()

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    delivery.webhook.url,
                    content=raw_body,
                    headers={
                        "Content-Type": "application/json",
                        "X-SmartRoute-Event": delivery.event,
                        "X-SmartRoute-Delivery-ID": delivery_id,
                        "X-SmartRoute-Timestamp": str(timestamp),
                        "X-SmartRoute-Signature-256": signature,
                        "User-Agent": "SmartRoute-Webhook/1.0",
                    },
                )
            latency_ms = int((time.time() - start) * 1000)
            response_body = response.text[:500]

            if response.is_success:
                from datetime import UTC, datetime

                now = datetime.now(UTC)
                delivery.status = "DELIVERED"
                delivery.response_status = response.status_code
                delivery.response_body = response_body
                delivery.attempts = attempt
                delivery.latency_ms = latency_ms
                delivery.delivered_at = now
                delivery.next_retry_at = None
                delivery.webhook.failure_count = 0
                delivery.webhook.last_triggered_at = now
                await self.db.flush()
                logger.info("webhook_delivered", delivery_id=delivery_id, latency_ms=latency_ms)
            else:
                await self._handle_failure(
                    delivery,
                    attempt,
                    latency_ms,
                    response.status_code,
                    response_body,
                )
        except Exception as exc:
            latency_ms = int((time.time() - start) * 1000)
            await self._handle_failure(delivery, attempt, latency_ms, None, str(exc))

    async def get_deliveries(self, webhook_id: str, workspace_id: str, limit: int = 50) -> list[dict]:
        await self.get(webhook_id, workspace_id)
        result = await self.db.execute(
            select(WebhookDelivery)
            .where(WebhookDelivery.webhook_id == webhook_id)
            .order_by(WebhookDelivery.created_at.desc())
            .limit(limit)
        )
        rows = result.scalars().all()
        return [
            {
                "id": row.id,
                "event": row.event,
                "status": row.status,
                "responseStatus": row.response_status,
                "attempts": row.attempts,
                "latencyMs": row.latency_ms,
                "deliveredAt": row.delivered_at.isoformat() if row.delivered_at else None,
                "createdAt": row.created_at.isoformat() if row.created_at else None,
            }
            for row in rows
        ]

    async def _find_webhook(self, webhook_id: str, workspace_id: str, *, orm: bool = False):
        result = await self.db.execute(
            select(Webhook).where(Webhook.id == webhook_id, Webhook.workspace_id == workspace_id)
        )
        webhook = result.scalar_one_or_none()
        if not webhook:
            raise AppError.not_found("Webhook not found")
        return webhook if orm else self._serialize_webhook(webhook)

    @staticmethod
    def _serialize_webhook(webhook: Webhook) -> dict:
        return {
            "id": webhook.id,
            "name": webhook.name,
            "url": webhook.url,
            "events": webhook.events,
            "status": webhook.status,
            "failureCount": webhook.failure_count,
            "lastTriggeredAt": webhook.last_triggered_at.isoformat() if webhook.last_triggered_at else None,
            "createdAt": webhook.created_at.isoformat() if webhook.created_at else None,
            "updatedAt": webhook.updated_at.isoformat() if webhook.updated_at else None,
        }

    async def _handle_failure(
        self,
        delivery: WebhookDelivery,
        attempt: int,
        latency_ms: int,
        response_status: int | None,
        response_body: str,
    ) -> None:
        is_final = attempt >= MAX_FAILURES
        delay_ms = RETRY_DELAYS_MS[attempt] if attempt < len(RETRY_DELAYS_MS) else 0
        delivery.status = "FAILED" if is_final else "RETRYING"
        delivery.response_status = response_status
        delivery.response_body = response_body
        delivery.attempts = attempt
        delivery.latency_ms = latency_ms
        if not is_final and delay_ms:
            from datetime import UTC, datetime, timedelta

            delivery.next_retry_at = datetime.now(UTC) + timedelta(milliseconds=delay_ms)
        else:
            delivery.next_retry_at = None

        webhook = delivery.webhook
        webhook.failure_count += 1
        if webhook.failure_count >= MAX_FAILURES:
            webhook.status = "FAILED"
        await self.db.flush()

        logger.warning(
            "webhook_delivery_failed",
            delivery_id=delivery.id,
            attempt=attempt,
            is_final=is_final,
        )
