"""Pydantic schemas for auth endpoints."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Literal

from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator

from smartroute.lib.constants import is_reserved_workspace_slug


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)


class RegisterRequest(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    workspace_name: str | None = Field(default=None, alias="workspaceName", min_length=2, max_length=100)
    workspace_slug: str | None = Field(default=None, alias="workspaceSlug")

    model_config = {"populate_by_name": True}

    @field_validator("workspace_slug")
    @classmethod
    def validate_slug(cls, value: str | None) -> str | None:
        if value is None:
            return value
        if not re.match(r"^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$", value):
            raise ValueError("Slug must be 3–40 lowercase letters, numbers, or hyphens")
        if len(value) < 3 or len(value) > 40:
            raise ValueError("Slug must be 3–40 lowercase letters, numbers, or hyphens")
        if is_reserved_workspace_slug(value):
            raise ValueError("Slug is reserved and cannot be used")
        return value


class RefreshTokenRequest(BaseModel):
    refresh_token: str = Field(alias="refreshToken")

    model_config = {"populate_by_name": True}


class LogoutRequest(BaseModel):
    refresh_token: str = Field(alias="refreshToken")

    model_config = {"populate_by_name": True}


class UpdateProfileRequest(BaseModel):
    name: str = Field(min_length=2, max_length=100)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(alias="currentPassword", min_length=1)
    new_password: str = Field(alias="newPassword", min_length=8, max_length=128)

    model_config = {"populate_by_name": True}


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=1)
    password: str = Field(min_length=8, max_length=128)


class SwitchWorkspaceRequest(BaseModel):
    workspace_id: UUID = Field(alias="workspaceId")

    model_config = {"populate_by_name": True}


class VerifyEmailRequest(BaseModel):
    token: str = Field(min_length=1)


class MfaCodeRequest(BaseModel):
    code: str = Field(min_length=6, max_length=16)


class MfaDisableRequest(BaseModel):
    password: str = Field(min_length=1)
    code: str = Field(min_length=6, max_length=16)


class MfaVerifyLoginRequest(BaseModel):
    mfa_token: str = Field(alias="mfaToken", min_length=1)
    code: str = Field(min_length=6, max_length=16)

    model_config = {"populate_by_name": True}


class RevokeOthersRequest(BaseModel):
    refresh_token: str = Field(alias="refreshToken", min_length=1)

    model_config = {"populate_by_name": True}


class DeleteAccountRequest(BaseModel):
    password: str = Field(min_length=1)


class AuthTokens(BaseModel):
    access_token: str = Field(alias="accessToken")
    refresh_token: str = Field(alias="refreshToken")
    expires_in: int = Field(alias="expiresIn")

    model_config = {"populate_by_name": True}


class WorkspaceSummary(BaseModel):
    id: str
    slug: str
    name: str
    role: str


class AuthUser(BaseModel):
    id: str
    email: str
    name: str
    avatar_url: str | None = Field(alias="avatarUrl", default=None)
    role: str
    email_verified: bool = Field(alias="emailVerified")
    mfa_enabled: bool = Field(alias="mfaEnabled")
    workspaces: list[WorkspaceSummary]

    model_config = {"populate_by_name": True}


class MessageResponse(BaseModel):
    message: str


class SessionInfo(BaseModel):
    id: str
    created_at: datetime = Field(alias="createdAt")
    expires_at: datetime = Field(alias="expiresAt")
    user_agent: str | None = Field(alias="userAgent", default=None)
    ip_address: str | None = Field(alias="ipAddress", default=None)

    model_config = {"populate_by_name": True}


class SuccessEnvelope(BaseModel):
    success: Literal[True] = True
    data: Any
