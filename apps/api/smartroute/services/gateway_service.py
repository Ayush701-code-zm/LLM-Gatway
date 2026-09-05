"""Gateway orchestration service."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass
from typing import Any

from smartroute.config.logger import logger
from smartroute.config.metrics import llm_request_duration
from smartroute.db.repository import GatewayRepository
from smartroute.engines.budget_guard import budget_guard
from smartroute.engines.circuit_breaker import circuit_breaker
from smartroute.engines.rate_limiter import rate_limiter_engine
from smartroute.engines.routing_engine import routing_engine
from smartroute.engines.semantic_cache import semantic_cache
from smartroute.errors import AppError
from smartroute.lib.gateway_metrics import gateway_metrics
from smartroute.lib.request_coalescer import request_coalescer
from smartroute.lib.token_estimator import estimate_tokens
from smartroute.providers.registry import provider_registry
from smartroute.queues import enqueue_analytics_event
from smartroute.lib.constants import RETRY_CONFIG
from smartroute.shared.schemas import ChatRequest
from smartroute.lib.utils import (
    calculate_cost_usd,
    calculate_exponential_backoff,
    calculate_savings_percent,
    sleep,
)
from smartroute.types.gateway import (
    ApiKeyContext,
    LLMMessage,
    LLMRequest,
    LLMStreamChunk,
    RateLimitInfo,
    RoutingContext,
    RoutingResult,
)


@dataclass
class StreamHandlers:
    on_routing: Callable[[dict[str, Any]], Awaitable[None] | None]
    on_delta: Callable[[str], Awaitable[None] | None]


@dataclass
class StreamDonePayload:
    request_id: str
    trace_id: str
    finish_reason: str
    usage: dict[str, int]
    cost: dict[str, float]
    routing: dict[str, Any]


@dataclass
class GatewayOptions:
    request_id: str
    trace_id: str
    api_key: ApiKeyContext
    on_rate_limit: Callable[[RateLimitInfo], None] | None = None


class GatewayService:
    async def process_chat(
        self,
        request: ChatRequest,
        options: GatewayOptions,
        repo: GatewayRepository,
    ) -> dict[str, Any]:
        request_id = options.request_id
        trace_id = options.trace_id
        api_key = options.api_key
        workspace_id = api_key.workspace_id
        overall_start = time.time()

        logger.info(
            "processing_chat_request",
            request_id=request_id,
            trace_id=trace_id,
            workspace_id=workspace_id,
            model=request.model,
        )

        rate_limit_info = await rate_limiter_engine.check(workspace_id, repo)
        if options.on_rate_limit:
            options.on_rate_limit(rate_limit_info)

        token_estimate = estimate_tokens(
            [{"role": "user", "content": request.message}],
            "gpt-4o" if request.model == "auto" else request.model,
            request.max_tokens,
        )
        await rate_limiter_engine.check_tokens(workspace_id, token_estimate.total_tokens, repo)
        await budget_guard.check(workspace_id, 0, repo)

        workspace = await repo.get_workspace_routing_config(workspace_id)
        cache_result = await semantic_cache.check(
            request.message,
            workspace_id,
            workspace.semantic_cache_enabled,
            repo,
            workspace.cache_threshold,
        )

        if cache_result.hit and cache_result.response:
            latency_ms = int((time.time() - overall_start) * 1000)
            await repo.create_request(
                {
                    "id": request_id,
                    "trace_id": trace_id,
                    "workspace_id": workspace_id,
                    "api_key_id": api_key.id,
                    "model_registry_id": None,
                    "status": "CACHED",
                    "prompt": request.message,
                    "system_prompt": request.system_prompt,
                    "requested_model": request.model,
                    "response": cache_result.response,
                    "finish_reason": "cache",
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "total_tokens": 0,
                    "actual_cost_usd": 0,
                    "baseline_cost_usd": cache_result.savings_usd or 0,
                    "savings_usd": cache_result.savings_usd or 0,
                    "total_latency_ms": latency_ms,
                    "provider_latency_ms": 0,
                    "cache_hit": True,
                    "cache_entry_id": cache_result.cache_entry_id,
                    "cache_similarity_score": cache_result.similarity_score,
                    "complexity_level": "SIMPLE",
                    "fallback_used": False,
                    "retry_count": 0,
                    "streaming_enabled": request.stream,
                }
            )

            gateway_metrics.record_request(
                provider="cache",
                model="semantic-cache",
                workspace_id=workspace_id,
                status="cached",
                latency_ms=latency_ms,
                actual_cost_usd=0,
                baseline_cost_usd=cache_result.savings_usd or 0,
                cache_hit=True,
            )
            await enqueue_analytics_event(
                {
                    "provider": "cache",
                    "model": "semantic-cache",
                    "workspaceId": workspace_id,
                    "status": "cached",
                    "latencyMs": latency_ms,
                    "actualCostUsd": 0,
                    "baselineCostUsd": cache_result.savings_usd or 0,
                    "cacheHit": True,
                }
            )

            return self._build_response(
                request_id=request_id,
                trace_id=trace_id,
                message=cache_result.response,
                model="cached",
                provider="cache",
                input_tokens=0,
                output_tokens=0,
                total_tokens=0,
                actual_cost_usd=0,
                baseline_cost_usd=cache_result.savings_usd or 0,
                savings_usd=cache_result.savings_usd or 0,
                total_latency_ms=int((time.time() - overall_start) * 1000),
                provider_latency_ms=0,
                cache_hit=True,
                complexity_level="SIMPLE",
                complexity_score=0,
                strategy="CACHE",
                fallback_used=False,
                retry_count=0,
                finish_reason="cache",
            )

        routing_result = await routing_engine.route(
            RoutingContext(
                workspace_id=workspace_id,
                prompt=request.message,
                requested_model=request.model,
                stream=request.stream,
            ),
            repo,
        )

        execution = await request_coalescer.coalesce(
            {
                "workspace_id": workspace_id,
                "model": routing_result.model_id,
                "messages": [{"role": "user", "content": request.message}],
                "temperature": request.temperature,
                "max_tokens": request.max_tokens,
            },
            lambda: self._execute_with_retry_and_fallback(
                request, routing_result, workspace_id, request_id, trace_id, repo
            ),
        )

        response = execution["response"]
        fallback_used = execution["fallback_used"]
        retry_count = execution["retry_count"]
        provider_used = execution["provider_used"]
        model_used = execution["model_used"]

        model_entry = await repo.find_model_by_provider_and_id(provider_used, model_used)
        actual_cost_usd = calculate_cost_usd(
            response.input_tokens,
            response.output_tokens,
            model_entry.input_cost_per_million if model_entry else 0,
            model_entry.output_cost_per_million if model_entry else 0,
        )

        premium_model = await repo.find_premium_model()
        baseline_cost_usd = calculate_cost_usd(
            response.input_tokens,
            response.output_tokens,
            premium_model.input_cost_per_million if premium_model else 10,
            premium_model.output_cost_per_million if premium_model else 30,
        )
        savings_usd = max(0.0, baseline_cost_usd - actual_cost_usd)

        await budget_guard.check(workspace_id, actual_cost_usd, repo)
        asyncio.create_task(budget_guard.record_spend(workspace_id, actual_cost_usd, repo))

        if not cache_result.hit and workspace.semantic_cache_enabled:
            asyncio.create_task(
                semantic_cache.store(
                    {
                        "prompt": request.message,
                        "response": response.content,
                        "model_id": model_used,
                        "provider": provider_used,
                        "workspace_id": workspace_id,
                        "input_tokens": response.input_tokens,
                        "output_tokens": response.output_tokens,
                        "cost_usd": actual_cost_usd,
                    },
                    repo,
                )
            )

        total_latency_ms = int((time.time() - overall_start) * 1000)
        await repo.create_request(
            {
                "id": request_id,
                "trace_id": trace_id,
                "workspace_id": workspace_id,
                "api_key_id": api_key.id,
                "model_registry_id": model_entry.id if model_entry else None,
                "status": "COMPLETED",
                "prompt": request.message,
                "system_prompt": request.system_prompt,
                "requested_model": request.model,
                "response": response.content,
                "finish_reason": response.finish_reason,
                "input_tokens": response.input_tokens,
                "output_tokens": response.output_tokens,
                "total_tokens": response.input_tokens + response.output_tokens,
                "actual_cost_usd": actual_cost_usd,
                "baseline_cost_usd": baseline_cost_usd,
                "savings_usd": savings_usd,
                "total_latency_ms": total_latency_ms,
                "provider_latency_ms": response.latency_ms,
                "cache_hit": False,
                "cache_entry_id": None,
                "cache_similarity_score": None,
                "complexity_level": routing_result.complexity_level,
                "fallback_used": fallback_used,
                "retry_count": retry_count,
                "streaming_enabled": request.stream,
            }
        )

        asyncio.create_task(
            repo.create_routing_decision(
                {
                    "request_id": request_id,
                    "model_registry_id": model_entry.id if model_entry else routing_result.model_registry_id,
                    "strategy": routing_result.strategy,
                    "complexity_level": routing_result.complexity_level,
                    "complexity_score": routing_result.complexity_score,
                    "candidate_models": [asdict(c) for c in routing_result.candidate_models],
                    "selection_reason": routing_result.selection_reason,
                    "estimated_cost_usd": actual_cost_usd,
                    "decision_latency_ms": routing_result.decision_latency_ms,
                }
            )
        )

        gateway_metrics.record_request(
            provider=provider_used,
            model=model_used,
            workspace_id=workspace_id,
            status="fallback" if fallback_used else "success",
            latency_ms=total_latency_ms,
            actual_cost_usd=actual_cost_usd,
            baseline_cost_usd=baseline_cost_usd,
            cache_hit=False,
        )
        await enqueue_analytics_event(
            {
                "provider": provider_used,
                "model": model_used,
                "workspaceId": workspace_id,
                "status": "fallback" if fallback_used else "success",
                "latencyMs": total_latency_ms,
                "actualCostUsd": actual_cost_usd,
                "baselineCostUsd": baseline_cost_usd,
                "cacheHit": False,
            }
        )

        logger.info(
            "chat_request_completed",
            request_id=request_id,
            provider=provider_used,
            model=model_used,
            total_latency_ms=total_latency_ms,
            actual_cost_usd=f"{actual_cost_usd:.6f}",
            savings_usd=f"{savings_usd:.6f}",
            fallback_used=fallback_used,
            retry_count=retry_count,
        )

        return self._build_response(
            request_id=request_id,
            trace_id=trace_id,
            message=response.content,
            model=model_used,
            provider=provider_used,
            input_tokens=response.input_tokens,
            output_tokens=response.output_tokens,
            total_tokens=response.input_tokens + response.output_tokens,
            actual_cost_usd=actual_cost_usd,
            baseline_cost_usd=baseline_cost_usd,
            savings_usd=savings_usd,
            total_latency_ms=total_latency_ms,
            provider_latency_ms=response.latency_ms,
            cache_hit=False,
            complexity_level=routing_result.complexity_level,
            complexity_score=routing_result.complexity_score,
            strategy=routing_result.strategy,
            fallback_used=fallback_used,
            retry_count=retry_count,
            finish_reason=response.finish_reason,
        )

    async def process_chat_stream(
        self,
        request: ChatRequest,
        options: GatewayOptions,
        handlers: StreamHandlers,
        repo: GatewayRepository,
    ) -> StreamDonePayload:
        request_id = options.request_id
        trace_id = options.trace_id
        api_key = options.api_key
        workspace_id = api_key.workspace_id
        overall_start = time.time()

        rate_limit_info = await rate_limiter_engine.check(workspace_id, repo)
        if options.on_rate_limit:
            options.on_rate_limit(rate_limit_info)

        token_estimate = estimate_tokens(
            [{"role": "user", "content": request.message}],
            "gpt-4o" if request.model == "auto" else request.model,
            request.max_tokens,
        )
        await rate_limiter_engine.check_tokens(workspace_id, token_estimate.total_tokens, repo)
        await budget_guard.check(workspace_id, 0, repo)

        workspace = await repo.get_workspace_routing_config(workspace_id)
        cache_result = await semantic_cache.check(
            request.message,
            workspace_id,
            workspace.semantic_cache_enabled,
            repo,
            workspace.cache_threshold,
        )

        if cache_result.hit and cache_result.response:
            latency_ms = int((time.time() - overall_start) * 1000)
            await self._emit_routing(
                handlers,
                {
                    "provider": "cache",
                    "model": "semantic-cache",
                    "complexityLevel": "SIMPLE",
                    "strategy": "CACHE",
                    "cacheHit": True,
                },
            )
            await self._emit_delta(handlers, cache_result.response)

            await repo.create_request(
                {
                    "id": request_id,
                    "trace_id": trace_id,
                    "workspace_id": workspace_id,
                    "api_key_id": api_key.id,
                    "model_registry_id": None,
                    "status": "CACHED",
                    "prompt": request.message,
                    "system_prompt": request.system_prompt,
                    "requested_model": request.model,
                    "response": cache_result.response,
                    "finish_reason": "cache",
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "total_tokens": 0,
                    "actual_cost_usd": 0,
                    "baseline_cost_usd": cache_result.savings_usd or 0,
                    "savings_usd": cache_result.savings_usd or 0,
                    "total_latency_ms": latency_ms,
                    "provider_latency_ms": 0,
                    "cache_hit": True,
                    "cache_entry_id": cache_result.cache_entry_id,
                    "cache_similarity_score": cache_result.similarity_score,
                    "complexity_level": "SIMPLE",
                    "fallback_used": False,
                    "retry_count": 0,
                    "streaming_enabled": True,
                }
            )

            gateway_metrics.record_request(
                provider="cache",
                model="semantic-cache",
                workspace_id=workspace_id,
                status="cached",
                latency_ms=latency_ms,
                actual_cost_usd=0,
                baseline_cost_usd=cache_result.savings_usd or 0,
                cache_hit=True,
            )
            await enqueue_analytics_event(
                {
                    "provider": "cache",
                    "model": "semantic-cache",
                    "workspaceId": workspace_id,
                    "status": "cached",
                    "latencyMs": latency_ms,
                    "actualCostUsd": 0,
                    "baselineCostUsd": cache_result.savings_usd or 0,
                    "cacheHit": True,
                }
            )

            return StreamDonePayload(
                request_id=request_id,
                trace_id=trace_id,
                finish_reason="cache",
                usage={"inputTokens": 0, "outputTokens": 0, "totalTokens": 0},
                cost={
                    "actualUsd": 0,
                    "baselineUsd": cache_result.savings_usd or 0,
                    "savingsUsd": cache_result.savings_usd or 0,
                },
                routing={
                    "provider": "cache",
                    "model": "semantic-cache",
                    "strategy": "CACHE",
                    "complexityLevel": "SIMPLE",
                    "fallbackUsed": False,
                    "retryCount": 0,
                },
            )

        routing_result = await routing_engine.route(
            RoutingContext(
                workspace_id=workspace_id,
                prompt=request.message,
                requested_model=request.model,
                stream=True,
            ),
            repo,
        )

        await self._emit_routing(
            handlers,
            {
                "provider": routing_result.provider,
                "model": routing_result.model_id,
                "complexityLevel": routing_result.complexity_level,
                "strategy": routing_result.strategy,
            },
        )

        execution = await self._execute_stream_with_retry_and_fallback(
            request,
            routing_result,
            request_id,
            trace_id,
            handlers.on_delta,
            repo,
        )

        response = execution["response"]
        fallback_used = execution["fallback_used"]
        retry_count = execution["retry_count"]
        provider_used = execution["provider_used"]
        model_used = execution["model_used"]

        model_entry = await repo.find_model_by_provider_and_id(provider_used, model_used)
        actual_cost_usd = calculate_cost_usd(
            response.input_tokens,
            response.output_tokens,
            model_entry.input_cost_per_million if model_entry else 0,
            model_entry.output_cost_per_million if model_entry else 0,
        )
        premium_model = await repo.find_premium_model()
        baseline_cost_usd = calculate_cost_usd(
            response.input_tokens,
            response.output_tokens,
            premium_model.input_cost_per_million if premium_model else 10,
            premium_model.output_cost_per_million if premium_model else 30,
        )
        savings_usd = max(0.0, baseline_cost_usd - actual_cost_usd)

        await budget_guard.check(workspace_id, actual_cost_usd, repo)
        asyncio.create_task(budget_guard.record_spend(workspace_id, actual_cost_usd, repo))

        if workspace.semantic_cache_enabled:
            asyncio.create_task(
                semantic_cache.store(
                    {
                        "prompt": request.message,
                        "response": response.content,
                        "model_id": model_used,
                        "provider": provider_used,
                        "workspace_id": workspace_id,
                        "input_tokens": response.input_tokens,
                        "output_tokens": response.output_tokens,
                        "cost_usd": actual_cost_usd,
                    },
                    repo,
                )
            )

        total_latency_ms = int((time.time() - overall_start) * 1000)
        await repo.create_request(
            {
                "id": request_id,
                "trace_id": trace_id,
                "workspace_id": workspace_id,
                "api_key_id": api_key.id,
                "model_registry_id": model_entry.id if model_entry else None,
                "status": "COMPLETED",
                "prompt": request.message,
                "system_prompt": request.system_prompt,
                "requested_model": request.model,
                "response": response.content,
                "finish_reason": response.finish_reason,
                "input_tokens": response.input_tokens,
                "output_tokens": response.output_tokens,
                "total_tokens": response.input_tokens + response.output_tokens,
                "actual_cost_usd": actual_cost_usd,
                "baseline_cost_usd": baseline_cost_usd,
                "savings_usd": savings_usd,
                "total_latency_ms": total_latency_ms,
                "provider_latency_ms": response.latency_ms,
                "cache_hit": False,
                "cache_entry_id": None,
                "cache_similarity_score": None,
                "complexity_level": routing_result.complexity_level,
                "fallback_used": fallback_used,
                "retry_count": retry_count,
                "streaming_enabled": True,
            }
        )

        asyncio.create_task(
            repo.create_routing_decision(
                {
                    "request_id": request_id,
                    "model_registry_id": model_entry.id if model_entry else routing_result.model_registry_id,
                    "strategy": routing_result.strategy,
                    "complexity_level": routing_result.complexity_level,
                    "complexity_score": routing_result.complexity_score,
                    "candidate_models": [asdict(c) for c in routing_result.candidate_models],
                    "selection_reason": routing_result.selection_reason,
                    "estimated_cost_usd": actual_cost_usd,
                    "decision_latency_ms": routing_result.decision_latency_ms,
                }
            )
        )

        gateway_metrics.record_request(
            provider=provider_used,
            model=model_used,
            workspace_id=workspace_id,
            status="fallback" if fallback_used else "success",
            latency_ms=total_latency_ms,
            actual_cost_usd=actual_cost_usd,
            baseline_cost_usd=baseline_cost_usd,
            cache_hit=False,
        )
        await enqueue_analytics_event(
            {
                "provider": provider_used,
                "model": model_used,
                "workspaceId": workspace_id,
                "status": "fallback" if fallback_used else "success",
                "latencyMs": total_latency_ms,
                "actualCostUsd": actual_cost_usd,
                "baselineCostUsd": baseline_cost_usd,
                "cacheHit": False,
            }
        )

        return StreamDonePayload(
            request_id=request_id,
            trace_id=trace_id,
            finish_reason=response.finish_reason,
            usage={
                "inputTokens": response.input_tokens,
                "outputTokens": response.output_tokens,
                "totalTokens": response.input_tokens + response.output_tokens,
            },
            cost={
                "actualUsd": actual_cost_usd,
                "baselineUsd": baseline_cost_usd,
                "savingsUsd": savings_usd,
            },
            routing={
                "provider": provider_used,
                "model": model_used,
                "strategy": routing_result.strategy,
                "complexityLevel": routing_result.complexity_level,
                "fallbackUsed": fallback_used,
                "retryCount": retry_count,
            },
        )

    async def _execute_stream_with_retry_and_fallback(
        self,
        request: ChatRequest,
        routing: RoutingResult,
        request_id: str,
        trace_id: str,
        on_delta: Callable[[str], Awaitable[None] | None],
        repo: GatewayRepository,
    ) -> dict[str, Any]:
        providers = [
            {"provider": routing.provider, "model": routing.model_id},
            *[
                {"provider": m.provider, "model": m.model_id}
                for m in await repo.find_fallback_models(routing.provider, routing.model_id)
            ],
        ]

        last_error: Exception | None = None
        retry_count = 0
        fallback_used = False

        for i, entry in enumerate(providers):
            provider_name = entry["provider"]
            model = entry["model"]
            is_first = i == 0
            max_attempts = RETRY_CONFIG["MAX_ATTEMPTS"] if is_first else 1

            for attempt in range(1, max_attempts + 1):
                if attempt > 1:
                    delay = calculate_exponential_backoff(
                        attempt - 1,
                        RETRY_CONFIG["BASE_DELAY_MS"],
                        RETRY_CONFIG["MAX_DELAY_MS"],
                    )
                    await sleep(delay)
                    retry_count += 1

                try:
                    if await circuit_breaker.is_open(provider_name, model):
                        raise RuntimeError(f"Circuit breaker OPEN for {provider_name}/{model}")

                    provider_client = provider_registry.get(provider_name)
                    llm_start = time.time()
                    messages = self._build_messages(request)

                    async def chunk_handler(chunk: LLMStreamChunk) -> None:
                        if not chunk.done and chunk.content:
                            result = on_delta(chunk.content)
                            if result is not None:
                                await result

                    llm_response = await provider_client.stream(
                        LLMRequest(
                            model=model,
                            messages=messages,
                            max_tokens=request.max_tokens,
                            temperature=request.temperature,
                            stream=True,
                        ),
                        chunk_handler,
                    )

                    llm_request_duration.labels(
                        provider=provider_name,
                        model=model,
                        status="success",
                    ).observe((time.time() - llm_start))

                    await circuit_breaker.record_success(provider_name, model)
                    gateway_metrics.update_circuit_breaker(provider_name, model, "CLOSED")

                    model_entry = await repo.find_model_by_provider_and_id(provider_name, model)
                    if model_entry:
                        asyncio.create_task(
                            repo.create_provider_log(
                                {
                                    "request_id": request_id,
                                    "model_registry_id": model_entry.id,
                                    "attempt_number": attempt,
                                    "success": True,
                                    "latency_ms": llm_response.latency_ms,
                                    "input_tokens": llm_response.input_tokens,
                                    "output_tokens": llm_response.output_tokens,
                                    "cost_usd": provider_client.calculate_cost(
                                        llm_response.input_tokens,
                                        llm_response.output_tokens,
                                        model,
                                    ),
                                }
                            )
                        )

                    if not is_first:
                        fallback_used = True
                        first = providers[0]
                        asyncio.create_task(
                            repo.create_fallback_event(
                                {
                                    "request_id": request_id,
                                    "failed_provider": first["provider"],
                                    "failed_model_id": first["model"],
                                    "fallback_provider": provider_name,
                                    "fallback_model_id": model,
                                    "failure_reason": str(last_error) if last_error else "unknown",
                                    "success": True,
                                    "fallback_latency_ms": llm_response.latency_ms,
                                }
                            )
                        )
                        gateway_metrics.record_fallback(first["provider"], provider_name)

                    return {
                        "response": llm_response,
                        "fallback_used": fallback_used,
                        "retry_count": retry_count,
                        "provider_used": provider_name,
                        "model_used": model,
                    }
                except Exception as err:
                    last_error = err
                    await circuit_breaker.record_failure(provider_name, model, repo)
                    gateway_metrics.update_circuit_breaker(provider_name, model, "OPEN")
                    if self._is_non_retryable(err):
                        raise
                    logger.warn(
                        "stream_provider_request_failed",
                        request_id=request_id,
                        trace_id=trace_id,
                        attempt=attempt,
                        provider=provider_name,
                        model=model,
                        err=str(err),
                    )

        raise AppError(
            502,
            "ALL_PROVIDERS_FAILED",
            "All providers failed to process the stream",
            {"lastError": str(last_error) if last_error else None},
        )

    async def _execute_with_retry_and_fallback(
        self,
        request: ChatRequest,
        routing: RoutingResult,
        workspace_id: str,
        request_id: str,
        trace_id: str,
        repo: GatewayRepository,
    ) -> dict[str, Any]:
        providers = [
            {"provider": routing.provider, "model": routing.model_id},
            *[
                {"provider": m.provider, "model": m.model_id}
                for m in await repo.find_fallback_models(routing.provider, routing.model_id)
            ],
        ]

        last_error: Exception | None = None
        retry_count = 0
        fallback_used = False

        for i, entry in enumerate(providers):
            provider_name = entry["provider"]
            model = entry["model"]
            is_first = i == 0
            max_attempts = RETRY_CONFIG["MAX_ATTEMPTS"] if is_first else 1

            for attempt in range(1, max_attempts + 1):
                if attempt > 1:
                    delay = calculate_exponential_backoff(
                        attempt - 1,
                        RETRY_CONFIG["BASE_DELAY_MS"],
                        RETRY_CONFIG["MAX_DELAY_MS"],
                    )
                    logger.info(
                        "retrying_provider_request",
                        request_id=request_id,
                        attempt=attempt,
                        delay=delay,
                        provider=provider_name,
                        model=model,
                    )
                    await sleep(delay)
                    retry_count += 1

                try:
                    if await circuit_breaker.is_open(provider_name, model):
                        raise RuntimeError(f"Circuit breaker OPEN for {provider_name}/{model}")

                    provider_client = provider_registry.get(provider_name)
                    llm_start = time.time()
                    messages = self._build_messages(request)

                    llm_response = await provider_client.generate(
                        LLMRequest(
                            model=model,
                            messages=messages,
                            max_tokens=request.max_tokens,
                            temperature=request.temperature,
                        )
                    )

                    llm_request_duration.labels(
                        provider=provider_name,
                        model=model,
                        status="success",
                    ).observe((time.time() - llm_start))

                    await circuit_breaker.record_success(provider_name, model)
                    gateway_metrics.update_circuit_breaker(provider_name, model, "CLOSED")

                    model_entry = await repo.find_model_by_provider_and_id(provider_name, model)
                    if model_entry:
                        asyncio.create_task(
                            repo.create_provider_log(
                                {
                                    "request_id": request_id,
                                    "model_registry_id": model_entry.id,
                                    "attempt_number": attempt,
                                    "success": True,
                                    "latency_ms": llm_response.latency_ms,
                                    "input_tokens": llm_response.input_tokens,
                                    "output_tokens": llm_response.output_tokens,
                                    "cost_usd": provider_client.calculate_cost(
                                        llm_response.input_tokens,
                                        llm_response.output_tokens,
                                        model,
                                    ),
                                }
                            )
                        )

                    if not is_first:
                        fallback_used = True
                        first = providers[0]
                        asyncio.create_task(
                            repo.create_fallback_event(
                                {
                                    "request_id": request_id,
                                    "failed_provider": first["provider"],
                                    "failed_model_id": first["model"],
                                    "fallback_provider": provider_name,
                                    "fallback_model_id": model,
                                    "failure_reason": str(last_error) if last_error else "unknown",
                                    "success": True,
                                    "fallback_latency_ms": llm_response.latency_ms,
                                }
                            )
                        )
                        gateway_metrics.record_fallback(first["provider"], provider_name)

                    return {
                        "response": llm_response,
                        "fallback_used": fallback_used,
                        "retry_count": retry_count,
                        "provider_used": provider_name,
                        "model_used": model,
                    }
                except Exception as err:
                    last_error = err
                    await circuit_breaker.record_failure(provider_name, model, repo)
                    gateway_metrics.update_circuit_breaker(provider_name, model, "OPEN")
                    if self._is_non_retryable(err):
                        raise
                    logger.warn(
                        "provider_request_failed",
                        request_id=request_id,
                        trace_id=trace_id,
                        attempt=attempt,
                        provider=provider_name,
                        model=model,
                        err=str(err),
                    )

        raise AppError(
            502,
            "ALL_PROVIDERS_FAILED",
            "All providers failed to process the request",
            {"lastError": str(last_error) if last_error else None},
        )

    def _build_messages(self, request: ChatRequest) -> list[LLMMessage]:
        messages: list[LLMMessage] = []
        if request.system_prompt:
            messages.append(LLMMessage(role="system", content=request.system_prompt))
        messages.append(LLMMessage(role="user", content=request.message))
        return messages

    def _is_non_retryable(self, err: Exception) -> bool:
        msg = str(err).lower()
        return any(
            token in msg
            for token in ("400", "401", "403", "invalid api key", "permission")
        )

    async def _emit_routing(self, handlers: StreamHandlers, payload: dict[str, Any]) -> None:
        result = handlers.on_routing(payload)
        if result is not None:
            await result

    async def _emit_delta(self, handlers: StreamHandlers, content: str) -> None:
        result = handlers.on_delta(content)
        if result is not None:
            await result

    def _build_response(self, **params: Any) -> dict[str, Any]:
        return {
            "requestId": params["request_id"],
            "traceId": params["trace_id"],
            "message": params["message"],
            "model": params["model"],
            "provider": params["provider"],
            "usage": {
                "inputTokens": params["input_tokens"],
                "outputTokens": params["output_tokens"],
                "totalTokens": params["total_tokens"],
            },
            "cost": {
                "actualUsd": params["actual_cost_usd"],
                "baselineUsd": params["baseline_cost_usd"],
                "savingsUsd": params["savings_usd"],
                "savingsPercent": calculate_savings_percent(
                    params["baseline_cost_usd"],
                    params["actual_cost_usd"],
                ),
            },
            "performance": {
                "totalLatencyMs": params["total_latency_ms"],
                "providerLatencyMs": params["provider_latency_ms"],
                "cacheHit": params["cache_hit"],
            },
            "routing": {
                "strategy": params["strategy"],
                "complexityLevel": params["complexity_level"],
                "complexityScore": params["complexity_score"],
                "fallbackUsed": params["fallback_used"],
                "retryCount": params["retry_count"],
            },
            "finishReason": params["finish_reason"],
        }


gateway_service = GatewayService()
