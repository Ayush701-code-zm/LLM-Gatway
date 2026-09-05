"""Async Redis client."""

from __future__ import annotations

from redis.asyncio import Redis

from smartroute.config.env import settings
from smartroute.config.logger import logger

_redis: Redis | None = None


def get_redis() -> Redis:
    global _redis
    if _redis is None:
        _redis = Redis.from_url(
            settings.redis_url,
            password=settings.redis_password or None,
            db=settings.redis_db,
            decode_responses=True,
        )
        logger.info("Redis client initialized")
    return _redis


async def disconnect_redis() -> None:
    global _redis
    if _redis is not None:
        await _redis.aclose()
        _redis = None
