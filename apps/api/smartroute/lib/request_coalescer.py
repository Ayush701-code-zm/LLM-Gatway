"""In-flight request coalescer."""

from __future__ import annotations

import asyncio
import hashlib
import json
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

from smartroute.config.logger import logger
from smartroute.config.metrics import coalesced_requests_total

T = TypeVar("T")


class RequestCoalescer:
    def __init__(self) -> None:
        self._inflight: dict[str, asyncio.Task[Any]] = {}

    async def coalesce(
        self,
        key: dict[str, Any],
        fn: Callable[[], Awaitable[T]],
    ) -> T:
        digest = self._hash(key)
        existing = self._inflight.get(digest)

        if existing and not existing.done():
            coalesced_requests_total.labels(workspace_id=str(key["workspace_id"])).inc()
            logger.debug(
                "request_coalesced",
                hash=digest[:8],
                workspace_id=key["workspace_id"],
            )
            return await existing

        task = asyncio.create_task(fn())
        self._inflight[digest] = task
        try:
            return await task
        finally:
            self._inflight.pop(digest, None)

    @property
    def size(self) -> int:
        return len(self._inflight)

    def _hash(self, key: dict[str, Any]) -> str:
        normalized = {
            "w": key["workspace_id"],
            "m": key["model"],
            "ms": [
                {
                    "r": msg["role"],
                    "c": " ".join(str(msg["content"]).strip().split()),
                }
                for msg in key["messages"]
            ],
            "t": key.get("temperature"),
            "mt": key.get("max_tokens"),
        }
        payload = json.dumps(normalized, sort_keys=True)
        return hashlib.sha256(payload.encode()).hexdigest()


request_coalescer = RequestCoalescer()
