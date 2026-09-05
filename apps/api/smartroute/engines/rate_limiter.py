"""Redis sliding-window rate limiter."""

from __future__ import annotations

import time

from smartroute.config.logger import logger
from smartroute.config.metrics import rate_limited_requests_total
from smartroute.db.repository import GatewayRepository
from smartroute.errors import AppError
from smartroute.lib.constants import PLAN_LIMITS
from smartroute.redis_client import get_redis
from smartroute.types.gateway import RateLimitInfo

REDIS_PREFIX = "rl:"


class RateLimiterEngine:
    async def check(self, workspace_id: str, repo: GatewayRepository) -> RateLimitInfo:
        redis = get_redis()
        plan, rpm_override, _, rpd_override = await repo.get_workspace_plan_limits(workspace_id)
        plan_limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["FREE"])
        rpm = rpm_override if rpm_override is not None else plan_limits["requestsPerMinute"]
        rpd = rpd_override if rpd_override is not None else plan_limits["requestsPerDay"]

        now_ms = int(time.time() * 1000)
        minute_window = now_ms // 60_000
        day_window = now_ms // 86_400_000

        rpm_key = f"{REDIS_PREFIX}rpm:{workspace_id}:{minute_window}"
        rpd_key = f"{REDIS_PREFIX}rpd:{workspace_id}:{day_window}"

        async with redis.pipeline(transaction=True) as pipe:
            pipe.incr(rpm_key)
            pipe.expire(rpm_key, 120)
            pipe.incr(rpd_key)
            pipe.expire(rpd_key, 172800)
            results = await pipe.execute()

        current_rpm = int(results[0])
        current_rpd = int(results[2])
        reset_rpm = (minute_window + 1) * 60
        reset_rpd = (day_window + 1) * 86400

        if current_rpm > rpm:
            rate_limited_requests_total.labels(workspace_id=workspace_id, reason="rpm").inc()
            logger.warn("rate_limit_exceeded_rpm", workspace_id=workspace_id, current=current_rpm, limit=rpm)
            raise AppError.rate_limit_exceeded(reset_rpm - int(time.time()))

        if current_rpd > rpd:
            rate_limited_requests_total.labels(workspace_id=workspace_id, reason="rpd").inc()
            logger.warn("rate_limit_exceeded_rpd", workspace_id=workspace_id, current=current_rpd, limit=rpd)
            raise AppError.rate_limit_exceeded(reset_rpd - int(time.time()))

        return RateLimitInfo(
            limit_rpm=rpm,
            limit_rpd=rpd,
            used_rpm=current_rpm,
            used_rpd=current_rpd,
            remaining_rpm=max(0, rpm - current_rpm),
            remaining_rpd=max(0, rpd - current_rpd),
            reset_rpm=reset_rpm,
            reset_rpd=reset_rpd,
        )

    async def get_status(self, workspace_id: str, repo: GatewayRepository) -> RateLimitInfo:
        redis = get_redis()
        plan, rpm_override, tpm_override, rpd_override = await repo.get_workspace_plan_limits(workspace_id)
        plan_limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["FREE"])
        rpm = rpm_override if rpm_override is not None else plan_limits["requestsPerMinute"]
        rpd = rpd_override if rpd_override is not None else plan_limits["requestsPerDay"]
        tpm = tpm_override if tpm_override is not None else plan_limits["tokensPerMinute"]

        now_ms = int(time.time() * 1000)
        minute_window = now_ms // 60_000
        day_window = now_ms // 86_400_000

        rpm_key = f"{REDIS_PREFIX}rpm:{workspace_id}:{minute_window}"
        rpd_key = f"{REDIS_PREFIX}rpd:{workspace_id}:{day_window}"
        tpm_key = f"{REDIS_PREFIX}tpm:{workspace_id}:{minute_window}"

        rpm_raw, rpd_raw, tpm_raw = await redis.mget(rpm_key, rpd_key, tpm_key)
        used_rpm = int(rpm_raw or 0)
        used_rpd = int(rpd_raw or 0)
        used_tpm = int(tpm_raw or 0)

        reset_rpm = (minute_window + 1) * 60
        reset_rpd = (day_window + 1) * 86400

        return {
            "limitRpm": rpm,
            "limitRpd": rpd,
            "usedRpm": used_rpm,
            "usedRpd": used_rpd,
            "remainingRpm": max(0, rpm - used_rpm),
            "remainingRpd": max(0, rpd - used_rpd),
            "resetRpm": reset_rpm,
            "resetRpd": reset_rpd,
            "limitTpm": tpm,
            "usedTpm": used_tpm,
            "remainingTpm": max(0, tpm - used_tpm),
        }

    async def check_tokens(
        self,
        workspace_id: str,
        estimated_tokens: int,
        repo: GatewayRepository,
    ) -> None:
        redis = get_redis()
        plan, _, tpm_override, _ = await repo.get_workspace_plan_limits(workspace_id)
        plan_limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["FREE"])
        tpm = tpm_override if tpm_override is not None else plan_limits["tokensPerMinute"]

        now_ms = int(time.time() * 1000)
        minute_window = now_ms // 60_000
        tpm_key = f"{REDIS_PREFIX}tpm:{workspace_id}:{minute_window}"

        async with redis.pipeline(transaction=True) as pipe:
            pipe.incrby(tpm_key, estimated_tokens)
            pipe.expire(tpm_key, 120)
            results = await pipe.execute()

        current_tpm = int(results[0])
        if current_tpm > tpm:
            rate_limited_requests_total.labels(workspace_id=workspace_id, reason="tpm").inc()
            raise AppError(
                429,
                "TOKEN_LIMIT_EXCEEDED",
                "Token per minute limit exceeded",
                {"retryAfter": 60},
            )


rate_limiter_engine = RateLimiterEngine()
