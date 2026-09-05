"""Semantic cache using pgvector cosine similarity."""

from __future__ import annotations

import hashlib
import time
from datetime import UTC, datetime, timedelta

from smartroute.config import settings
from smartroute.config.logger import logger
from smartroute.config.metrics import cache_hits_total, cache_misses_total
from smartroute.db.repository import GatewayRepository
from smartroute.providers.registry import provider_registry
from smartroute.types.gateway import CacheCheckResult


class SemanticCacheEngine:
    def __init__(self) -> None:
        self.threshold = settings.SEMANTIC_CACHE_THRESHOLD

    async def check(
        self,
        prompt: str,
        workspace_id: str,
        use_cache: bool,
        repo: GatewayRepository,
        threshold_override: float | None = None,
    ) -> CacheCheckResult:
        if not use_cache:
            return CacheCheckResult(hit=False, latency_ms=0)

        threshold = threshold_override if threshold_override is not None else self.threshold
        start = time.time()

        try:
            embedding = await self._generate_embedding(prompt)
            embedding_str = f"[{','.join(str(v) for v in embedding)}]"

            results = await repo.semantic_cache_search(embedding_str, workspace_id, threshold)

            if results:
                hit = results[0]
                cache_hits_total.labels(workspace_id=workspace_id).inc()

                try:
                    await repo.update_cache_entry_hit(str(hit.id), float(hit.cost_usd))
                except Exception:
                    pass

                logger.debug(
                    "semantic_cache_hit",
                    cache_entry_id=str(hit.id),
                    similarity=float(hit.similarity),
                    workspace_id=workspace_id,
                )

                return CacheCheckResult(
                    hit=True,
                    response=str(hit.response),
                    cache_entry_id=str(hit.id),
                    similarity_score=float(hit.similarity),
                    latency_ms=int((time.time() - start) * 1000),
                    savings_usd=float(hit.cost_usd),
                )

            cache_misses_total.labels(workspace_id=workspace_id).inc()
            return CacheCheckResult(hit=False, latency_ms=int((time.time() - start) * 1000))
        except Exception as exc:
            logger.error("semantic_cache_check_failed", err=str(exc))
            return CacheCheckResult(hit=False, latency_ms=int((time.time() - start) * 1000))

    async def store(
        self,
        params: dict[str, object],
        repo: GatewayRepository,
    ) -> None:
        try:
            prompt = str(params["prompt"])
            embedding = await self._generate_embedding(prompt)
            embedding_str = f"[{','.join(str(v) for v in embedding)}]"
            prompt_hash = hashlib.sha256(prompt.encode()).hexdigest()
            expires_at = datetime.now(UTC) + timedelta(seconds=settings.CACHE_TTL_SECONDS)

            await repo.store_cache_entry(
                {
                    "workspace_id": params["workspace_id"],
                    "prompt_hash": prompt_hash,
                    "prompt": prompt,
                    "response": params["response"],
                    "model_id": params["model_id"],
                    "provider": params["provider"],
                    "input_tokens": params["input_tokens"],
                    "output_tokens": params["output_tokens"],
                    "cost_usd": params["cost_usd"],
                    "embedding": embedding_str,
                    "expires_at": expires_at,
                }
            )
            logger.debug("cache_entry_stored", prompt_hash=prompt_hash[:8])
        except Exception as exc:
            logger.error("cache_entry_store_failed", err=str(exc))

    async def _generate_embedding(self, text: str) -> list[float]:
        openai = provider_registry.get("OPENAI")
        return await openai.generate_embedding(text, settings.EMBEDDING_MODEL)


semantic_cache = SemanticCacheEngine()
