"""Embeddings routes."""

from __future__ import annotations

import math
import time
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from smartroute.config import settings
from smartroute.engines.rate_limiter import rate_limiter_engine
from smartroute.errors import AppError
from smartroute.lib.gateway_metrics import gateway_metrics
from smartroute.providers.registry import provider_registry
from smartroute.routes.deps import get_repository, require_any_scope
from smartroute.shared.schemas import EmbeddingsRequest
from smartroute.types.gateway import GatewayRequestState

router = APIRouter(prefix="/embeddings", tags=["embeddings"])


@router.post("")
async def create_embeddings(
    body: EmbeddingsRequest,
    state: Annotated[GatewayRequestState, Depends(require_any_scope("embeddings:write", "chat:write"))],
    repo=Depends(get_repository),
):
    workspace_id = state.api_key.workspace_id
    model = body.model or settings.EMBEDDING_MODEL

    try:
        await rate_limiter_engine.check(workspace_id, repo)
    except AppError as err:
        return JSONResponse(
            status_code=err.status_code,
            content={
                "success": False,
                "error": {"code": err.code, "message": err.message, "details": err.details},
            },
        )

    model_entry = await repo.get_embedding_model(model)
    if not model_entry:
        raise AppError.bad_request(f'Embedding model "{model}" not found or not enabled')

    provider = provider_registry.get(model_entry.provider)
    texts = body.input if isinstance(body.input, list) else [body.input]
    start = time.time()

    embeddings = []
    for text in texts:
        embeddings.append(await provider.generate_embedding(text, model))

    latency_ms = int((time.time() - start) * 1000)
    total_tokens = sum(math.ceil(len(t) / 4) for t in texts)

    gateway_metrics.record_request(
        provider=model_entry.provider,
        model=model,
        workspace_id=workspace_id,
        status="success",
        latency_ms=latency_ms,
        actual_cost_usd=(total_tokens / 1_000_000) * model_entry.input_cost_per_million,
        baseline_cost_usd=0,
        cache_hit=False,
    )

    return {
        "success": True,
        "data": {
            "model": model,
            "provider": model_entry.provider,
            "embeddings": embeddings[0] if len(embeddings) == 1 else embeddings,
            "dimensions": len(embeddings[0]) if embeddings else 0,
            "usage": {"totalTokens": total_tokens, "latencyMs": latency_ms},
        },
    }
