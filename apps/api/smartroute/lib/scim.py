"""SCIM 2.0 helpers."""

from __future__ import annotations

import hashlib
import secrets
from typing import Annotated

from fastapi import Depends, Header
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smartroute.db import get_db
from smartroute.errors import AppError
from smartroute.models import Workspace


def generate_scim_token() -> dict[str, str]:
    raw = f"sr_scim_{secrets.token_hex(24)}"
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    prefix = f"{raw[:20]}…"
    return {"raw": raw, "hash": token_hash, "prefix": prefix}


def to_scim_user(member) -> dict:
    active = member.user.deleted_at is None
    return {
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
        "id": member.user.id,
        "userName": member.user.email,
        "name": {"formatted": member.user.name},
        "emails": [{"value": member.user.email, "primary": True}],
        "active": active,
        "meta": {"resourceType": "User"},
        "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {"role": member.role},
    }


async def require_scim_auth(
    authorization: Annotated[str | None, Header()] = None,
    db: Annotated[AsyncSession, Depends(get_db)] = ...,
) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise AppError.unauthorized("SCIM bearer token required")

    token = authorization[7:].strip()
    if not token.startswith("sr_scim_"):
        raise AppError.unauthorized("Invalid SCIM token")

    token_hash = hashlib.sha256(token.encode()).hexdigest()
    result = await db.execute(
        select(Workspace.id).where(
            Workspace.scim_enabled.is_(True),
            Workspace.scim_token_hash == token_hash,
            Workspace.deleted_at.is_(None),
            Workspace.plan == "ENTERPRISE",
        )
    )
    workspace_id = result.scalar_one_or_none()
    if not workspace_id:
        raise AppError.unauthorized("Invalid SCIM token")
    return workspace_id
