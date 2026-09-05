"""Model registry routes."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Response

from smartroute.config.logger import logger
from smartroute.errors import AppError
from smartroute.middleware.auth import AuthPayload, can_admin, require_auth
from smartroute.routes.deps import get_repository
from smartroute.shared.schemas import CreateModelRequest, PatchModelRequest

router = APIRouter(prefix="/models", tags=["models"])


def _serialize_model(model) -> dict[str, Any]:
    return {
        "id": model.id,
        "provider": model.provider,
        "modelId": model.model_id,
        "displayName": model.display_name,
        "description": model.description,
        "inputCostPerMillion": model.input_cost_per_million,
        "outputCostPerMillion": model.output_cost_per_million,
        "contextWindow": model.context_window,
        "maxOutputTokens": model.max_output_tokens,
        "supportsStreaming": model.supports_streaming,
        "supportsVision": model.supports_vision,
        "supportsFunctions": model.supports_functions,
        "supportsEmbeddings": model.supports_embeddings,
        "qualityTier": model.quality_tier,
        "complexityMinLevel": model.complexity_min_level,
        "availabilityStatus": model.availability_status,
        "avgLatencyMs": model.avg_latency_ms,
        "p95LatencyMs": model.p95_latency_ms,
        "successRate": model.success_rate,
        "isEnabled": model.is_enabled,
        "updatedAt": model.updated_at.isoformat() if model.updated_at else None,
    }


@router.get("")
async def list_models(
    provider: str | None = Query(default=None),
    enabled: str | None = Query(default=None),
    quality_tier: str | None = Query(default=None, alias="qualityTier"),
    repo=Depends(get_repository),
):
    enabled_bool = None if enabled is None else enabled.lower() == "true"
    models = await repo.list_models(provider, enabled_bool, quality_tier)
    return {"success": True, "data": [_serialize_model(m) for m in models]}


@router.get("/{model_id}")
async def get_model(model_id: str, repo=Depends(get_repository)):
    model = await repo.get_model_by_id(model_id)
    if not model:
        raise AppError.not_found(f"Model {model_id} not found")
    return {"success": True, "data": _serialize_model(model)}


@router.post("")
async def create_model(
    body: CreateModelRequest,
    _user: Annotated[AuthPayload, Depends(require_auth)],
    _role: Annotated[str, Depends(can_admin)],
    repo=Depends(get_repository),
):
    if await repo.model_exists(body.provider, body.model_id):
        raise AppError.conflict(f"Model {body.provider}/{body.model_id} already exists")

    model = await repo.create_model(
        {
            "provider": body.provider,
            "model_id": body.model_id,
            "display_name": body.display_name,
            "description": body.description,
            "input_cost_per_million": body.input_cost_per_million,
            "output_cost_per_million": body.output_cost_per_million,
            "context_window": body.context_window,
            "max_output_tokens": body.max_output_tokens,
            "supports_streaming": body.supports_streaming,
            "supports_vision": body.supports_vision,
            "supports_functions": body.supports_functions,
            "supports_embeddings": body.supports_embeddings,
            "quality_tier": body.quality_tier,
            "complexity_min_level": body.complexity_min_level,
            "is_enabled": body.is_enabled,
        }
    )
    logger.info("model_registered", model_id=model.id, provider=model.provider, model_name=model.model_id)
    return {"success": True, "data": _serialize_model(model)}


@router.patch("/{model_id}")
async def patch_model(
    model_id: str,
    body: PatchModelRequest,
    _user: Annotated[AuthPayload, Depends(require_auth)],
    _role: Annotated[str, Depends(can_admin)],
    repo=Depends(get_repository),
):
    existing = await repo.get_model_by_id(model_id)
    if not existing:
        raise AppError.not_found(f"Model {model_id} not found")

    updates = body.model_dump(by_alias=False, exclude_none=True)
    model = await repo.update_model(model_id, updates)
    logger.info("model_updated", model_id=model.id, changes=updates)
    return {"success": True, "data": _serialize_model(model)}


@router.post("/{model_id}/enable")
async def enable_model(
    model_id: str,
    _user: Annotated[AuthPayload, Depends(require_auth)],
    _role: Annotated[str, Depends(can_admin)],
    repo=Depends(get_repository),
):
    model = await repo.update_model(model_id, {"is_enabled": True, "availability_status": "AVAILABLE"})
    logger.info("model_enabled", model_id=model.id)
    return {"success": True, "data": _serialize_model(model)}


@router.post("/{model_id}/disable")
async def disable_model(
    model_id: str,
    _user: Annotated[AuthPayload, Depends(require_auth)],
    _role: Annotated[str, Depends(can_admin)],
    repo=Depends(get_repository),
):
    model = await repo.update_model(model_id, {"is_enabled": False, "availability_status": "UNAVAILABLE"})
    logger.info("model_disabled", model_id=model.id)
    return {"success": True, "data": _serialize_model(model)}


@router.delete("/{model_id}")
async def delete_model(
    model_id: str,
    _user: Annotated[AuthPayload, Depends(require_auth)],
    _role: Annotated[str, Depends(can_admin)],
    repo=Depends(get_repository),
):
    existing = await repo.get_model_by_id(model_id)
    if not existing:
        raise AppError.not_found(f"Model {model_id} not found")
    await repo.delete_model(model_id)
    logger.warn("model_deleted", model_id=model_id)
    return Response(status_code=204)
