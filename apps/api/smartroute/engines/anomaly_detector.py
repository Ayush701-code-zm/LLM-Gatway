"""Anomaly detection engine."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

from smartroute.config.logger import logger
from smartroute.config.metrics import anomalies_detected_total
from smartroute.redis_client import get_redis
from smartroute.db.repository import GatewayRepository
from smartroute.queues import dispatch_webhook_event

LOOKBACK_MINUTES = 15
BASELINE_DAYS = 7
COST_SPIKE_RATIO = 3.0
VOLUME_SPIKE_RATIO = 3.0
LATENCY_SPIKE_RATIO = 2.0
ERROR_RATE_THRESHOLD = 0.20
COOLDOWN_MINUTES = 60

AnomalyType = Literal["cost_spike", "volume_spike", "latency_spike", "error_surge"]


@dataclass
class AnomalyEvent:
    type: AnomalyType
    workspace_id: str
    value: float
    baseline: float
    ratio: float
    message: str


class AnomalyDetectorEngine:
    async def run_for_all_workspaces(self, repo: GatewayRepository) -> None:
        workspace_ids = await repo.get_active_workspaces()
        for workspace_id in workspace_ids:
            try:
                await self.analyse_workspace(workspace_id, repo)
            except Exception as exc:
                logger.error("anomaly_analysis_failed", workspace_id=workspace_id, err=str(exc))

    async def analyse_workspace(self, workspace_id: str, repo: GatewayRepository) -> None:
        now = datetime.now(UTC)
        window_from = now - timedelta(minutes=LOOKBACK_MINUTES)
        baseline_from = now - timedelta(days=BASELINE_DAYS)

        recent_avg_cost, recent_latency, _, recent_count = await repo.aggregate_requests(
            workspace_id,
            window_from,
            None,
            ["COMPLETED", "FAILED", "CACHED"],
        )
        baseline_avg_cost, baseline_latency, _, baseline_count = await repo.aggregate_requests(
            workspace_id,
            baseline_from,
            window_from,
            ["COMPLETED", "CACHED"],
        )

        if recent_count == 0:
            return
        if baseline_count < 10:
            return

        anomalies: list[AnomalyEvent] = []

        if baseline_avg_cost > 0 and recent_avg_cost > 0:
            cost_ratio = recent_avg_cost / baseline_avg_cost
            if cost_ratio >= COST_SPIKE_RATIO:
                anomalies.append(
                    AnomalyEvent(
                        type="cost_spike",
                        workspace_id=workspace_id,
                        value=recent_avg_cost,
                        baseline=baseline_avg_cost,
                        ratio=cost_ratio,
                        message=(
                            f"Cost per request ${recent_avg_cost:.4f} is {cost_ratio:.1f}× "
                            f"the 7-day average (${baseline_avg_cost:.4f})"
                        ),
                    )
                )

        baseline_rpm = baseline_count / (BASELINE_DAYS * 24 * 60)
        recent_rpm = recent_count / LOOKBACK_MINUTES
        if baseline_rpm > 0:
            volume_ratio = recent_rpm / baseline_rpm
            if volume_ratio >= VOLUME_SPIKE_RATIO:
                anomalies.append(
                    AnomalyEvent(
                        type="volume_spike",
                        workspace_id=workspace_id,
                        value=recent_rpm,
                        baseline=baseline_rpm,
                        ratio=volume_ratio,
                        message=(
                            f"Request rate {recent_rpm:.1f} req/min is {volume_ratio:.1f}× "
                            f"the 7-day average ({baseline_rpm:.1f} req/min)"
                        ),
                    )
                )

        if baseline_latency > 0 and recent_latency > 0:
            latency_ratio = recent_latency / baseline_latency
            if latency_ratio >= LATENCY_SPIKE_RATIO:
                anomalies.append(
                    AnomalyEvent(
                        type="latency_spike",
                        workspace_id=workspace_id,
                        value=recent_latency,
                        baseline=baseline_latency,
                        ratio=latency_ratio,
                        message=(
                            f"Avg latency {recent_latency:.0f}ms is {latency_ratio:.1f}× "
                            f"the 7-day average ({baseline_latency:.0f}ms)"
                        ),
                    )
                )

        recent_errors = await repo.count_failed_requests(workspace_id, window_from)
        error_rate = recent_errors / recent_count if recent_count > 0 else 0.0
        if error_rate >= ERROR_RATE_THRESHOLD and recent_count >= 5:
            anomalies.append(
                AnomalyEvent(
                    type="error_surge",
                    workspace_id=workspace_id,
                    value=error_rate,
                    baseline=0.0,
                    ratio=error_rate,
                    message=(
                        f"Error rate {error_rate * 100:.1f}% in last {LOOKBACK_MINUTES} min "
                        f"({recent_errors}/{recent_count} requests failed)"
                    ),
                )
            )

        for anomaly in anomalies:
            await self._fire_anomaly(anomaly, repo)

    async def _fire_anomaly(self, anomaly: AnomalyEvent, repo: GatewayRepository) -> None:
        redis = get_redis()
        cool_key = f"anomaly:{anomaly.workspace_id}:{anomaly.type}"

        try:
            if await redis.get(cool_key):
                return
            await redis.set(cool_key, "1", ex=COOLDOWN_MINUTES * 60)
        except Exception:
            pass

        anomalies_detected_total.labels(
            workspace_id=anomaly.workspace_id,
            anomaly_type=anomaly.type,
        ).inc()

        logger.warn("anomaly_detected", anomaly_type=anomaly.type, message=anomaly.message)

        try:
            await repo.create_notification(
                {
                    "workspace_id": anomaly.workspace_id,
                    "type": "ANOMALY_DETECTED",
                    "title": f"⚠️ Anomaly: {anomaly.type.replace('_', ' ')}",
                    "body": anomaly.message,
                    "metadata": {
                        "type": anomaly.type,
                        "value": anomaly.value,
                        "baseline": anomaly.baseline,
                        "ratio": anomaly.ratio,
                    },
                }
            )
        except Exception as exc:
            logger.error("anomaly_notification_failed", err=str(exc))

        try:
            await dispatch_webhook_event(
                anomaly.workspace_id,
                "anomaly.detected",
                {
                    "type": anomaly.type,
                    "message": anomaly.message,
                    "value": anomaly.value,
                    "baseline": anomaly.baseline,
                    "ratio": anomaly.ratio,
                },
            )
        except Exception as exc:
            logger.error("anomaly_webhook_failed", err=str(exc))


anomaly_detector = AnomalyDetectorEngine()
