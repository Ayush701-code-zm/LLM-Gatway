"""API key routes — /api/v1/api-keys."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from smartroute.db import get_db
from smartroute.lib.responses import success_response
from smartroute.middleware.auth import (
    AuthPayload,
    can_write,
    load_workspace_role,
    require_auth,
    require_email_verified,
)
from smartroute.schemas.workspace import CreateApiKeyRequest
from smartroute.services.api_key_service import ApiKeyService

router = APIRouter(prefix="/api-keys", tags=["api-keys"])


def _ok(data: object, status_code: int = status.HTTP_200_OK, meta: dict | None = None) -> Response:
    extra = {"meta": meta} if meta else {}
    return success_response(data, status_code=status_code, **extra)


@router.get("", dependencies=[Depends(require_auth), Depends(load_workspace_role)])
async def list_api_keys(
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    keys = await ApiKeyService(db).list(user.workspace_id)
    return _ok(keys)


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_auth), Depends(load_workspace_role), Depends(can_write), Depends(require_email_verified)],
)
async def create_api_key(
    body: CreateApiKeyRequest,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    key = await ApiKeyService(db).create(user.workspace_id, user.sub, body)
    return _ok(
        key,
        status.HTTP_201_CREATED,
        meta={"warning": "Store the rawKey securely. It will not be shown again."},
    )


@router.delete(
    "/{key_id}",
    dependencies=[Depends(require_auth), Depends(load_workspace_role), Depends(can_write)],
)
async def revoke_api_key(
    key_id: str,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await ApiKeyService(db).revoke(user.workspace_id, key_id, user.sub)
    return _ok({"message": "API key revoked"})


@router.post(
    "/{key_id}/rotate",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_auth), Depends(load_workspace_role), Depends(can_write)],
)
async def rotate_api_key(
    key_id: str,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    new_key = await ApiKeyService(db).rotate(user.workspace_id, key_id, user.sub)
    return _ok(
        new_key,
        status.HTTP_201_CREATED,
        meta={"warning": "Store the rawKey securely. It will not be shown again."},
    )
