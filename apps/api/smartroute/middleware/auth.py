"""Authentication and workspace-role middleware."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header, Request
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smartroute.config import settings
from smartroute.db import get_db
from smartroute.errors import AppError
from smartroute.lib.constants import ERROR_CODES
from smartroute.models import User, WorkspaceMember


@dataclass
class AuthPayload:
    sub: str
    workspace_id: str
    email: str
    role: str

    @property
    def workspaceId(self) -> str:
        return self.workspace_id


async def require_auth(
    authorization: Annotated[str | None, Header()] = None,
) -> AuthPayload:
    if not authorization or not authorization.startswith("Bearer "):
        raise AppError.unauthorized("Missing or malformed Authorization header")

    token = authorization[7:]
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
    except JWTError as exc:
        if "expired" in str(exc).lower():
            raise AppError(401, ERROR_CODES["TOKEN_EXPIRED"], "Access token has expired") from exc
        raise AppError.unauthorized("Invalid access token") from exc

    sub = payload.get("sub")
    workspace_id = payload.get("workspaceId")
    email = payload.get("email")
    role = payload.get("role")
    if not sub or not workspace_id or not email:
        raise AppError.unauthorized("Invalid access token")

    return AuthPayload(sub=sub, workspace_id=workspace_id, email=email, role=role or "USER")


WorkspaceRole = str


async def load_workspace_role(
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> WorkspaceRole:
    result = await db.execute(
        select(WorkspaceMember.role).where(
            WorkspaceMember.user_id == user.sub,
            WorkspaceMember.workspace_id == user.workspace_id,
        )
    )
    role = result.scalar_one_or_none()
    if not role:
        raise AppError.forbidden("You are not a member of this workspace")
    return role


def require_workspace_role(*roles: str):
    async def dependency(workspace_role: Annotated[str, Depends(load_workspace_role)]) -> str:
        if workspace_role not in roles:
            raise AppError.forbidden(f"Requires one of: {', '.join(roles)}")
        return workspace_role

    return dependency


can_write = require_workspace_role("OWNER", "ADMIN", "MEMBER")
can_admin = require_workspace_role("OWNER", "ADMIN")
can_owner = require_workspace_role("OWNER")


async def require_email_verified(
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AuthPayload:
    if not settings.REQUIRE_EMAIL_VERIFICATION:
        return user

    result = await db.execute(
        select(User.email_verified, User.deleted_at).where(User.id == user.sub)
    )
    row = result.one_or_none()
    if not row or row.deleted_at:
        raise AppError.unauthorized("Invalid user")
    if not row.email_verified:
        raise AppError(
            403,
            "EMAIL_NOT_VERIFIED",
            "Verify your email before using this feature. Check your inbox or resend from the dashboard.",
        )
    return user


def get_auth_user_id(user: AuthPayload) -> str:
    return user.sub


def get_auth_workspace_id(user: AuthPayload) -> str:
    return user.workspace_id


def get_client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


async def require_super_admin(
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AuthPayload:
    result = await db.execute(select(User.role).where(User.id == user.sub, User.deleted_at.is_(None)))
    role = result.scalar_one_or_none()
    if role != "SUPER_ADMIN":
        raise AppError.forbidden("Super-admin access required")
    return user
