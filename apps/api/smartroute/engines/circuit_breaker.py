"""Redis-backed circuit breaker."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

from smartroute.config.logger import logger
from smartroute.config.metrics import circuit_breaker_state
from smartroute.db.repository import GatewayRepository
from smartroute.lib.constants import CIRCUIT_BREAKER
from smartroute.redis_client import get_redis
from smartroute.types.gateway import CircuitBreakerStatus, CircuitState

REDIS_PREFIX = "cb:"


def _key(provider: str, model: str) -> str:
    return f"{REDIS_PREFIX}{provider}:{model}"


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _serialize_status(status: CircuitBreakerStatus) -> str:
    payload = {
        "state": status.state,
        "failureCount": status.failure_count,
        "successCount": status.success_count,
        "lastFailureAt": status.last_failure_at.isoformat() if status.last_failure_at else None,
        "nextAttemptAt": status.next_attempt_at.isoformat() if status.next_attempt_at else None,
    }
    return json.dumps(payload)


def _deserialize_status(raw: str) -> CircuitBreakerStatus:
    data = json.loads(raw)
    return CircuitBreakerStatus(
        state=data["state"],
        failure_count=data.get("failureCount", 0),
        success_count=data.get("successCount", 0),
        last_failure_at=_parse_dt(data.get("lastFailureAt")),
        next_attempt_at=_parse_dt(data.get("nextAttemptAt")),
    )


class CircuitBreakerEngine:
    async def get_status(self, provider: str, model: str) -> CircuitBreakerStatus:
        try:
            redis = get_redis()
            raw = await redis.get(_key(provider, model))
            if not raw:
                return CircuitBreakerStatus(state="CLOSED", failure_count=0, success_count=0)
            return _deserialize_status(raw)
        except Exception as exc:
            logger.warn("circuit_breaker_redis_read_failed", err=str(exc), provider=provider, model=model)
            return CircuitBreakerStatus(state="CLOSED", failure_count=0, success_count=0)

    async def is_open(self, provider: str, model: str) -> bool:
        status = await self.get_status(provider, model)

        if status.state == "CLOSED":
            return False

        if status.state == "OPEN":
            now = datetime.now(UTC)
            if status.next_attempt_at and status.next_attempt_at <= now:
                await self._set_state(provider, model, "HALF_OPEN", status)
                return False
            return True

        return False

    async def record_success(self, provider: str, model: str) -> None:
        status = await self.get_status(provider, model)

        if status.state == "HALF_OPEN":
            new_success = status.success_count + 1
            if new_success >= CIRCUIT_BREAKER["SUCCESS_THRESHOLD"]:
                await self._close(provider, model, status)
            else:
                await self._set_state(
                    provider,
                    model,
                    "HALF_OPEN",
                    CircuitBreakerStatus(
                        state="HALF_OPEN",
                        failure_count=status.failure_count,
                        success_count=new_success,
                        last_failure_at=status.last_failure_at,
                        next_attempt_at=status.next_attempt_at,
                    ),
                )
        elif status.state == "CLOSED":
            await self._set_state(
                provider,
                model,
                "CLOSED",
                CircuitBreakerStatus(
                    state="CLOSED",
                    failure_count=0,
                    success_count=status.success_count + 1,
                ),
            )

        circuit_breaker_state.labels(provider=provider, model=model).set(0)

    async def record_failure(self, provider: str, model: str, repo: GatewayRepository | None = None) -> None:
        status = await self.get_status(provider, model)
        new_failure_count = status.failure_count + 1

        if status.state == "HALF_OPEN" or new_failure_count >= CIRCUIT_BREAKER["FAILURE_THRESHOLD"]:
            await self._open(provider, model, status, new_failure_count, repo)
        else:
            await self._set_state(
                provider,
                model,
                "CLOSED",
                CircuitBreakerStatus(
                    state="CLOSED",
                    failure_count=new_failure_count,
                    success_count=status.success_count,
                    last_failure_at=datetime.now(UTC),
                ),
            )

    async def _open(
        self,
        provider: str,
        model: str,
        current: CircuitBreakerStatus,
        failure_count: int,
        repo: GatewayRepository | None,
    ) -> None:
        next_attempt_at = datetime.now(UTC) + timedelta(milliseconds=CIRCUIT_BREAKER["TIMEOUT_MS"])
        await self._set_state(
            provider,
            model,
            "OPEN",
            CircuitBreakerStatus(
                state="OPEN",
                failure_count=failure_count,
                success_count=current.success_count,
                last_failure_at=datetime.now(UTC),
                next_attempt_at=next_attempt_at,
            ),
        )
        logger.warn("circuit_breaker_opened", provider=provider, model=model, failure_count=failure_count)
        circuit_breaker_state.labels(provider=provider, model=model).set(1)

        if repo:
            try:
                await repo.create_circuit_breaker_event(
                    {
                        "provider": provider,
                        "model_id": model,
                        "from_state": "HALF_OPEN" if current.state == "HALF_OPEN" else "CLOSED",
                        "to_state": "OPEN",
                        "reason": f"{failure_count} consecutive failures",
                        "failure_count": failure_count,
                        "success_count": None,
                        "resolved_at": None,
                    }
                )
            except Exception as exc:
                logger.error("circuit_breaker_event_persist_failed", err=str(exc))

    async def _close(
        self,
        provider: str,
        model: str,
        current: CircuitBreakerStatus,
        repo: GatewayRepository | None = None,
    ) -> None:
        await self._set_state(
            provider,
            model,
            "CLOSED",
            CircuitBreakerStatus(state="CLOSED", failure_count=0, success_count=0),
        )
        logger.info("circuit_breaker_closed", provider=provider, model=model)
        circuit_breaker_state.labels(provider=provider, model=model).set(0)

        if repo:
            try:
                await repo.create_circuit_breaker_event(
                    {
                        "provider": provider,
                        "model_id": model,
                        "from_state": "HALF_OPEN",
                        "to_state": "CLOSED",
                        "reason": "Sufficient successful probe requests",
                        "failure_count": current.failure_count,
                        "success_count": current.success_count,
                        "resolved_at": datetime.now(UTC),
                    }
                )
            except Exception as exc:
                logger.error("circuit_breaker_event_persist_failed", err=str(exc))

    async def _set_state(
        self,
        provider: str,
        model: str,
        state: CircuitState,
        data: CircuitBreakerStatus,
    ) -> None:
        redis = get_redis()
        payload = CircuitBreakerStatus(
            state=state,
            failure_count=data.failure_count,
            success_count=data.success_count,
            last_failure_at=data.last_failure_at,
            next_attempt_at=data.next_attempt_at,
        )
        await redis.set(_key(provider, model), _serialize_status(payload), ex=300)


circuit_breaker = CircuitBreakerEngine()
