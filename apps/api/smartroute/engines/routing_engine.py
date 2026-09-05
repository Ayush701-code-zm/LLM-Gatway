"""Routing engine — selects optimal model/provider."""

from __future__ import annotations

import random
import time

from smartroute.config.logger import logger
from smartroute.redis_client import get_redis
from smartroute.db.repository import GatewayRepository
from smartroute.engines.circuit_breaker import circuit_breaker
from smartroute.engines.complexity_classifier import ComplexityLevel, classify_complexity
from smartroute.types.gateway import CandidateModel, ModelRegistryRow, RoutingContext, RoutingResult


class RoutingEngine:
    async def route(self, ctx: RoutingContext, repo: GatewayRepository) -> RoutingResult:
        start = time.time()

        workspace = await repo.get_workspace_routing_config(ctx.workspace_id)
        strategy = workspace.default_routing_strategy
        allowed_providers = workspace.allowed_providers

        complexity = classify_complexity(ctx.prompt)
        complexity_level = str(complexity["level"])
        complexity_score = float(complexity["score"])

        candidates = await repo.find_models_for_routing(
            allowed_providers,
            self._get_eligible_complexity_levels(complexity_level),  # type: ignore[arg-type]
        )

        if not candidates:
            raise RuntimeError("No eligible models found for routing")

        available: list[ModelRegistryRow] = []
        for model in candidates:
            if not await circuit_breaker.is_open(model.provider, model.model_id):
                available.append(model)

        if not available:
            logger.warn("all_candidate_circuit_breakers_open", workspace_id=ctx.workspace_id)
            available = list(candidates)

        selected = await self._select_by_strategy(available, strategy, ctx.workspace_id)

        candidate_models = [
            CandidateModel(
                provider=m.provider,
                model_id=m.model_id,
                estimated_cost_usd=0.0,
                reason=m.quality_tier,
                selected=m.id == selected.id,
            )
            for m in available
        ]

        decision_latency_ms = int((time.time() - start) * 1000)

        logger.debug(
            "routing_decision_made",
            workspace_id=ctx.workspace_id,
            strategy=strategy,
            complexity_level=complexity_level,
            complexity_score=complexity_score,
            selected=f"{selected.provider}/{selected.model_id}",
            decision_latency_ms=decision_latency_ms,
        )

        return RoutingResult(
            provider=selected.provider,
            model_id=selected.model_id,
            model_registry_id=selected.id,
            complexity_level=complexity_level,
            complexity_score=complexity_score,
            strategy=strategy,
            selection_reason=self._build_selection_reason(strategy, complexity_level, selected.quality_tier),
            estimated_cost_usd=0.0,
            decision_latency_ms=decision_latency_ms,
            candidate_models=candidate_models,
        )

    def _get_eligible_complexity_levels(self, level: ComplexityLevel) -> list[str]:
        if level == "SIMPLE":
            return ["SIMPLE"]
        if level == "MEDIUM":
            return ["SIMPLE", "MEDIUM"]
        return ["SIMPLE", "MEDIUM", "COMPLEX"]

    async def _select_by_strategy(
        self,
        candidates: list[ModelRegistryRow],
        strategy: str,
        workspace_id: str,
    ) -> ModelRegistryRow:
        if strategy == "COST_OPTIMIZED":
            return sorted(
                candidates,
                key=lambda m: m.input_cost_per_million + m.output_cost_per_million,
            )[0]

        if strategy == "LATENCY_OPTIMIZED":
            return sorted(candidates, key=lambda m: m.avg_latency_ms or 9999)[0]

        if strategy == "PRIORITY_BASED":
            priority_map = {"ECONOMY": 0, "STANDARD": 1, "PREMIUM": 2}
            return sorted(candidates, key=lambda m: priority_map.get(m.quality_tier, 0), reverse=True)[0]

        if strategy == "ROUND_ROBIN":
            redis = get_redis()
            key = f"routing:rr:{workspace_id}"
            idx = await redis.incr(key)
            if idx == 1:
                await redis.expire(key, 3600)
            return candidates[(idx - 1) % len(candidates)]

        if strategy == "WEIGHTED_RANDOM":
            weights = [1 / (c.input_cost_per_million + c.output_cost_per_million + 0.01) for c in candidates]
            total = sum(weights)
            roll = random.random() * total
            for i, weight in enumerate(weights):
                roll -= weight
                if roll <= 0:
                    return candidates[i]
            return candidates[-1]

        return candidates[0]

    def _build_selection_reason(self, strategy: str, complexity: str, quality_tier: str) -> str:
        return f"Strategy={strategy}, Complexity={complexity}, QualityTier={quality_tier}"


routing_engine = RoutingEngine()
