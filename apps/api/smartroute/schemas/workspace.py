"""Pydantic schemas for workspace, member, and API key endpoints."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

from smartroute.lib.constants import is_reserved_workspace_slug

RoutingStrategy = Literal[
    "PRIORITY_BASED",
    "COST_OPTIMIZED",
    "LATENCY_OPTIMIZED",
    "ROUND_ROBIN",
    "WEIGHTED_RANDOM",
]

ProviderName = Literal["OPENAI", "ANTHROPIC", "GOOGLE", "OLLAMA", "COHERE", "MISTRAL"]

BudgetPeriod = Literal["DAILY", "WEEKLY", "MONTHLY", "YEARLY", "TOTAL"]

MemberRole = Literal["ADMIN", "MEMBER", "VIEWER"]


class CreateWorkspaceRequest(BaseModel):
    name: str = Field(min_length=2, max_length=60)


class PatchWorkspaceRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    slug: str | None = None
    default_routing_strategy: RoutingStrategy | None = Field(default=None, alias="defaultRoutingStrategy")
    semantic_cache_enabled: bool | None = Field(default=None, alias="semanticCacheEnabled")
    cache_threshold: float | None = Field(default=None, ge=0.5, le=1.0)
    allowed_providers: list[ProviderName] | None = Field(default=None, alias="allowedProviders")
    requests_per_minute: int | None = Field(default=None, alias="requestsPerMinute")
    requests_per_day: int | None = Field(default=None, alias="requestsPerDay")
    tokens_per_minute: int | None = Field(default=None, alias="tokensPerMinute")

    model_config = {"populate_by_name": True}

    @field_validator("slug")
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


class CreateBudgetRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    limit_usd: float = Field(alias="limitUsd", gt=0)
    period: BudgetPeriod
    alert_at_80: bool = Field(default=True, alias="alertAt80")
    alert_at_90: bool = Field(default=True, alias="alertAt90")
    block_at_100: bool = Field(default=True, alias="blockAt100")

    model_config = {"populate_by_name": True}


class InviteMemberRequest(BaseModel):
    email: EmailStr
    role: MemberRole = "MEMBER"


class AcceptInviteRequest(BaseModel):
    token: str = Field(min_length=32)


class PatchMemberRequest(BaseModel):
    role: MemberRole


class CreateApiKeyRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    expires_at: datetime | None = Field(default=None, alias="expiresAt")
    scopes: list[str] = Field(default_factory=lambda: ["chat:write", "analytics:read"])
    rate_limit_rpm: int | None = Field(default=None, alias="rateLimitRpm", ge=1)
    rate_limit_tpm: int | None = Field(default=None, alias="rateLimitTpm", ge=1)

    model_config = {"populate_by_name": True}


class PaginationMeta(BaseModel):
    page: int
    limit: int
    total: int
    total_pages: int = Field(alias="totalPages")
    has_next: bool = Field(alias="hasNext")
    has_prev: bool = Field(alias="hasPrev")

    model_config = {"populate_by_name": True}


class PaginatedAuditLogs(BaseModel):
    data: list[Any]
    pagination: PaginationMeta
