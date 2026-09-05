"""Celery application replacing BullMQ."""

from __future__ import annotations

from celery import Celery

from smartroute.config import settings

celery_app = Celery(
    "smartroute",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=["smartroute.workers.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_default_queue="default",
    worker_prefetch_multiplier=1,
    task_acks_late=True,
    beat_schedule={
        "health-check-all": {"task": "smartroute.workers.tasks.run_health_checks", "schedule": 120.0},
        "process-budget-alerts": {"task": "smartroute.workers.tasks.process_budget_alerts", "schedule": 60.0},
        "api-key-expiry-scan": {"task": "smartroute.workers.tasks.scan_api_key_expiry", "schedule": 86400.0},
        "cache-cleanup": {"task": "smartroute.workers.tasks.run_cache_maintenance", "schedule": 3600.0},
        "anomaly-scan": {"task": "smartroute.workers.tasks.run_anomaly_detection", "schedule": 900.0},
        "daily-aggregation-all": {"task": "smartroute.workers.tasks.run_daily_aggregation_all", "schedule": 86400.0},
        "model-pricing-sync": {"task": "smartroute.workers.tasks.sync_model_pricing", "schedule": 604800.0},
    },
)
