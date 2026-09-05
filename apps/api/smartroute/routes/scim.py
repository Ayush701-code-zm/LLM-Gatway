"""SCIM workspace config and /scim/v2 API routes."""

from __future__ import annotations

import secrets
from typing import Annotated

import bcrypt
from fastapi import APIRouter, Depends, status
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from smartroute.config import settings
from smartroute.db import get_db
from smartroute.errors import AppError
from smartroute.lib.plan_enforcement import enforce_member_limit
from smartroute.lib.scim import generate_scim_token, require_scim_auth, to_scim_user
from smartroute.middleware.auth import (
    AuthPayload,
    can_admin,
    get_auth_user_id,
    get_auth_workspace_id,
    load_workspace_role,
    require_auth,
)
from smartroute.models import AuditAction, AuditLog, User, Workspace, WorkspaceMember

workspace_router = APIRouter(prefix="/workspaces", tags=["scim"])
scim_router = APIRouter(prefix="/scim/v2", tags=["scim"])


class PatchScimRequest(BaseModel):
    enabled: bool | None = None
    regenerateToken: bool | None = None


from smartroute.lib.responses import success_response


def _ok(data: object) -> Response:
    return success_response(data)


def _scim_base_url() -> str:
    return f"{settings.API_BASE_URL.rstrip('/')}/scim/v2"


async def _require_enterprise(db: AsyncSession, workspace_id: str) -> Workspace:
    workspace = await db.get(Workspace, workspace_id)
    if not workspace:
        raise AppError.not_found("Workspace not found")
    if workspace.plan != "ENTERPRISE":
        raise AppError.forbidden("SCIM is available on the Enterprise plan only")
    return workspace


@workspace_router.get("/current/scim", dependencies=[Depends(require_auth), Depends(load_workspace_role), Depends(can_admin)])
async def get_current_scim(
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    ws = await _require_enterprise(db, get_auth_workspace_id(user))
    return _ok(
        {
            "enabled": ws.scim_enabled,
            "tokenPrefix": ws.scim_token_prefix,
            "baseUrl": _scim_base_url(),
            "hasToken": bool(ws.scim_token_hash),
        }
    )


@workspace_router.patch("/current/scim", dependencies=[Depends(require_auth), Depends(load_workspace_role), Depends(can_admin)])
async def patch_current_scim(
    body: PatchScimRequest,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    workspace_id = get_auth_workspace_id(user)
    await _require_enterprise(db, workspace_id)

    token_payload: dict[str, str] = {}
    ws = await db.get(Workspace, workspace_id)
    if not ws:
        raise AppError.not_found("Workspace not found")

    if body.regenerateToken or (body.enabled and not ws.scim_token_hash):
        generated = generate_scim_token()
        token_payload = generated

    if body.enabled is not None:
        ws.scim_enabled = body.enabled
    if token_payload.get("hash"):
        ws.scim_token_hash = token_payload["hash"]
        ws.scim_token_prefix = token_payload["prefix"]

    db.add(
        AuditLog(
            workspace_id=workspace_id,
            user_id=get_auth_user_id(user),
            action=AuditAction.SETTINGS_UPDATED.value,
            resource_type="scim",
            metadata_={"enabled": ws.scim_enabled, "tokenRotated": bool(body.regenerateToken)},
        )
    )
    await db.flush()

    data = {
        "enabled": ws.scim_enabled,
        "tokenPrefix": ws.scim_token_prefix,
        "baseUrl": _scim_base_url(),
        "hasToken": bool(ws.scim_token_hash),
    }
    if token_payload.get("raw"):
        data["token"] = token_payload["raw"]
    return _ok(data)


@scim_router.get("/ServiceProviderConfig")
async def service_provider_config():
    return {
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
        "patch": {"supported": True},
        "bulk": {"supported": False},
        "filter": {"supported": False},
        "authenticationSchemes": [{"type": "oauthbearertoken", "name": "Bearer Token"}],
    }


@scim_router.get("/Users")
async def list_users(
    workspace_id: Annotated[str, Depends(require_scim_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(WorkspaceMember)
        .options(selectinload(WorkspaceMember.user))
        .where(WorkspaceMember.workspace_id == workspace_id)
    )
    members = result.scalars().all()
    return {
        "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        "totalResults": len(members),
        "Resources": [to_scim_user(member) for member in members],
    }


@scim_router.post("/Users", status_code=status.HTTP_201_CREATED)
async def create_user(
    body: dict,
    workspace_id: Annotated[str, Depends(require_scim_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    user_name = (body.get("userName") or "").lower().strip()
    emails = body.get("emails") or []
    email = (emails[0].get("value") if emails else None) or user_name
    email = (email or "").lower().strip()
    name = (body.get("name") or {}).get("formatted") or (email.split("@")[0] if email else "User")

    if not email:
        raise AppError.bad_request("userName or emails[0].value is required")

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user or user.deleted_at:
        hashed = bcrypt.hashpw(secrets.token_hex(32).encode(), bcrypt.gensalt(12)).decode()
        user = User(email=email, name=name, hashed_password=hashed, email_verified=True, role="USER")
        db.add(user)
        await db.flush()

    existing = await db.execute(
        select(WorkspaceMember)
        .options(selectinload(WorkspaceMember.user))
        .where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user.id)
    )
    member = existing.scalar_one_or_none()
    if member:
        return JSONResponse(status_code=200, content=to_scim_user(member))

    await enforce_member_limit(db, workspace_id)
    member = WorkspaceMember(workspace_id=workspace_id, user_id=user.id, role="MEMBER")
    db.add(member)
    await db.flush()
    member.user = user

    db.add(
        AuditLog(
            workspace_id=workspace_id,
            user_id=user.id,
            action=AuditAction.MEMBER_ADDED.value,
            resource_type="member",
            resource_id=member.id,
            metadata_={"via": "scim"},
        )
    )
    await db.flush()
    return JSONResponse(status_code=201, content=to_scim_user(member))


@scim_router.get("/Users/{user_id}")
async def get_user(
    user_id: str,
    workspace_id: Annotated[str, Depends(require_scim_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(WorkspaceMember)
        .options(selectinload(WorkspaceMember.user))
        .where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user_id)
    )
    member = result.scalar_one_or_none()
    if not member:
        raise AppError.not_found("User not found")
    return to_scim_user(member)


@scim_router.patch("/Users/{user_id}")
async def patch_user(
    user_id: str,
    body: dict,
    workspace_id: Annotated[str, Depends(require_scim_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(WorkspaceMember)
        .options(selectinload(WorkspaceMember.user))
        .where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user_id)
    )
    member = result.scalar_one_or_none()
    if not member:
        raise AppError.not_found("User not found")

    active = body.get("active")
    if active is False:
        await db.execute(delete(WorkspaceMember).where(WorkspaceMember.id == member.id))
        db.add(
            AuditLog(
                workspace_id=workspace_id,
                user_id=user_id,
                action=AuditAction.MEMBER_REMOVED.value,
                resource_type="member",
                resource_id=member.id,
                metadata_={"via": "scim"},
            )
        )
        await db.flush()
        payload = to_scim_user(member)
        payload["active"] = False
        return payload

    return to_scim_user(member)
