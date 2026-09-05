"""API key lifecycle management."""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timezone

from sqlalchemy import inspect as sa_inspect, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from smartroute.errors import AppError
from smartroute.lib.plan_enforcement import enforce_api_key_limit
from smartroute.lib.utils import mask_api_key
from smartroute.models import ApiKey, ApiKeyStatus, AuditAction, AuditLog
from smartroute.schemas.workspace import CreateApiKeyRequest


def _serialize_api_key(key: ApiKey, *, raw_key: str | None = None, masked: bool = False) -> dict:
    data = {
        "id": key.id,
        "name": key.name,
        "keyPrefix": key.key_prefix,
        "status": key.status,
        "scopes": key.scopes,
        "expiresAt": key.expires_at,
        "lastUsedAt": key.last_used_at,
        "requestCount": str(key.request_count),
        "createdAt": key.created_at,
    }
    if "created_by" not in sa_inspect(key).unloaded:
        created_by = key.created_by
        if created_by:
            data["createdBy"] = {"name": created_by.name, "email": created_by.email}
    if masked:
        data["maskedKey"] = mask_api_key(key.key_prefix + "****")
    if raw_key:
        data["rawKey"] = raw_key
    return data


class ApiKeyService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create(self, workspace_id: str, user_id: str, data: CreateApiKeyRequest) -> dict:
        await enforce_api_key_limit(self.db, workspace_id)

        raw = f"sk-{secrets.token_urlsafe(32)}"
        key_hash = hashlib.sha256(raw.encode()).hexdigest()
        key_prefix = raw[:14]

        api_key = ApiKey(
            workspace_id=workspace_id,
            created_by_id=user_id,
            name=data.name,
            key_hash=key_hash,
            key_prefix=key_prefix,
            scopes=data.scopes,
            expires_at=data.expires_at,
            rate_limit_rpm=data.rate_limit_rpm,
            rate_limit_tpm=data.rate_limit_tpm,
        )
        self.db.add(api_key)
        await self.db.flush()

        self.db.add(
            AuditLog(
                workspace_id=workspace_id,
                user_id=user_id,
                action=AuditAction.API_KEY_CREATED.value,
                resource_type="api_key",
                resource_id=api_key.id,
                metadata_={"name": data.name},
            )
        )
        await self.db.flush()

        return _serialize_api_key(api_key, raw_key=raw)

    async def list(self, workspace_id: str) -> list[dict]:
        result = await self.db.execute(
            select(ApiKey)
            .options(selectinload(ApiKey.created_by))
            .where(ApiKey.workspace_id == workspace_id, ApiKey.status != ApiKeyStatus.REVOKED.value)
            .order_by(ApiKey.created_at.desc())
        )
        keys = result.scalars().all()
        return [_serialize_api_key(key, masked=True) for key in keys]

    async def revoke(self, workspace_id: str, key_id: str, user_id: str) -> None:
        result = await self.db.execute(
            select(ApiKey).where(ApiKey.id == key_id, ApiKey.workspace_id == workspace_id)
        )
        key = result.scalar_one_or_none()
        if not key:
            raise AppError.not_found("API key not found")
        if key.status == ApiKeyStatus.REVOKED.value:
            raise AppError.conflict("API key already revoked")

        key.status = ApiKeyStatus.REVOKED.value
        key.revoked_at = datetime.now(timezone.utc)
        key.revoked_by = user_id

        self.db.add(
            AuditLog(
                workspace_id=workspace_id,
                user_id=user_id,
                action=AuditAction.API_KEY_REVOKED.value,
                resource_type="api_key",
                resource_id=key_id,
            )
        )
        await self.db.flush()

    async def rotate(self, workspace_id: str, key_id: str, user_id: str) -> dict:
        result = await self.db.execute(
            select(ApiKey).where(
                ApiKey.id == key_id,
                ApiKey.workspace_id == workspace_id,
                ApiKey.status == ApiKeyStatus.ACTIVE.value,
            )
        )
        existing = result.scalar_one_or_none()
        if not existing:
            raise AppError.not_found("Active API key not found")

        existing.status = ApiKeyStatus.REVOKED.value
        existing.revoked_at = datetime.now(timezone.utc)
        existing.revoked_by = user_id
        await self.db.flush()

        new_key = await self.create(
            workspace_id,
            user_id,
            CreateApiKeyRequest(
                name=f"{existing.name} (rotated)",
                scopes=existing.scopes,
                expiresAt=existing.expires_at,
                rateLimitRpm=existing.rate_limit_rpm,
                rateLimitTpm=existing.rate_limit_tpm,
            ),
        )

        self.db.add(
            AuditLog(
                workspace_id=workspace_id,
                user_id=user_id,
                action=AuditAction.API_KEY_ROTATED.value,
                resource_type="api_key",
                resource_id=key_id,
                metadata_={"newKeyId": new_key["id"]},
            )
        )
        await self.db.flush()
        return new_key
