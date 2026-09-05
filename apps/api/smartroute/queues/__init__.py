"""Background job helpers backed by Celery."""

from __future__ import annotations

from typing import Any

from smartroute.config.logger import logger


async def enqueue_analytics_event(payload: dict[str, Any]) -> None:
    try:
        from smartroute.workers.tasks import record_analytics_event

        record_analytics_event.delay(payload)
    except Exception as exc:
        logger.debug("analytics_event_enqueue_failed", err=str(exc))


async def enqueue_webhook_delivery(delivery_id: str, delay_ms: int = 0) -> None:
    try:
        from smartroute.workers.tasks import deliver_webhook

        deliver_webhook.apply_async(args=[delivery_id], countdown=max(0, delay_ms // 1000))
    except Exception as exc:
        logger.debug("webhook_delivery_enqueue_failed", delivery_id=delivery_id, err=str(exc))


async def dispatch_webhook_event(
    workspace_id: str,
    event_type: str,
    payload: dict[str, Any],
) -> None:
    try:
        from smartroute.db import AsyncSessionLocal
        from smartroute.services.webhook_service import WebhookService

        async with AsyncSessionLocal() as session:
            service = WebhookService(session)
            delivery_ids = await service.dispatch(workspace_id, event_type, payload)
            await session.commit()

        for delivery_id in delivery_ids:
            await enqueue_webhook_delivery(delivery_id)
    except Exception as exc:
        logger.error("webhook_dispatch_failed", workspace_id=workspace_id, event=event_type, err=str(exc))
