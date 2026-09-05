"""SQLAlchemy ORM models matching the Prisma schema."""

from __future__ import annotations

import enum
from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from smartroute.db import Base
from smartroute.models.pg_enums import pg_enum


def _uuid() -> str:
    return str(uuid4())


class UserRole(str, enum.Enum):
    SUPER_ADMIN = "SUPER_ADMIN"
    USER = "USER"


class WorkspaceMemberRole(str, enum.Enum):
    OWNER = "OWNER"
    ADMIN = "ADMIN"
    MEMBER = "MEMBER"
    VIEWER = "VIEWER"


class ApiKeyStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    REVOKED = "REVOKED"
    EXPIRED = "EXPIRED"


class PlanTier(str, enum.Enum):
    FREE = "FREE"
    PRO = "PRO"
    ENTERPRISE = "ENTERPRISE"


class BudgetPeriod(str, enum.Enum):
    DAILY = "DAILY"
    WEEKLY = "WEEKLY"
    MONTHLY = "MONTHLY"
    YEARLY = "YEARLY"
    TOTAL = "TOTAL"


class AlertSeverity(str, enum.Enum):
    INFO = "INFO"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"


class AlertStatus(str, enum.Enum):
    PENDING = "PENDING"
    SENT = "SENT"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    RESOLVED = "RESOLVED"


class LoadBalancingStrategy(str, enum.Enum):
    PRIORITY_BASED = "PRIORITY_BASED"
    COST_OPTIMIZED = "COST_OPTIMIZED"
    LATENCY_OPTIMIZED = "LATENCY_OPTIMIZED"
    ROUND_ROBIN = "ROUND_ROBIN"
    WEIGHTED_RANDOM = "WEIGHTED_RANDOM"


class NotificationType(str, enum.Enum):
    BUDGET_WARNING = "BUDGET_WARNING"
    BUDGET_CRITICAL = "BUDGET_CRITICAL"
    BUDGET_EXCEEDED = "BUDGET_EXCEEDED"
    PROVIDER_DOWN = "PROVIDER_DOWN"
    PROVIDER_DEGRADED = "PROVIDER_DEGRADED"
    PROVIDER_RECOVERED = "PROVIDER_RECOVERED"
    CIRCUIT_BREAKER_OPEN = "CIRCUIT_BREAKER_OPEN"
    CIRCUIT_BREAKER_CLOSED = "CIRCUIT_BREAKER_CLOSED"
    RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED"
    API_KEY_EXPIRING = "API_KEY_EXPIRING"
    ANOMALY_DETECTED = "ANOMALY_DETECTED"
    WORKSPACE_SLUG_CHANGED = "WORKSPACE_SLUG_CHANGED"


class AuditAction(str, enum.Enum):
    USER_LOGIN = "USER_LOGIN"
    USER_LOGOUT = "USER_LOGOUT"
    USER_CREATED = "USER_CREATED"
    USER_UPDATED = "USER_UPDATED"
    API_KEY_CREATED = "API_KEY_CREATED"
    API_KEY_REVOKED = "API_KEY_REVOKED"
    API_KEY_ROTATED = "API_KEY_ROTATED"
    WORKSPACE_CREATED = "WORKSPACE_CREATED"
    WORKSPACE_UPDATED = "WORKSPACE_UPDATED"
    WORKSPACE_DELETED = "WORKSPACE_DELETED"
    MEMBER_ADDED = "MEMBER_ADDED"
    MEMBER_REMOVED = "MEMBER_REMOVED"
    MEMBER_ROLE_CHANGED = "MEMBER_ROLE_CHANGED"
    BUDGET_CREATED = "BUDGET_CREATED"
    BUDGET_UPDATED = "BUDGET_UPDATED"
    BUDGET_ALERT_SENT = "BUDGET_ALERT_SENT"
    PROVIDER_ENABLED = "PROVIDER_ENABLED"
    PROVIDER_DISABLED = "PROVIDER_DISABLED"
    ROUTING_CONFIG_CHANGED = "ROUTING_CONFIG_CHANGED"
    SETTINGS_UPDATED = "SETTINGS_UPDATED"
    WEBHOOK_CREATED = "WEBHOOK_CREATED"
    WEBHOOK_UPDATED = "WEBHOOK_UPDATED"
    WEBHOOK_DELETED = "WEBHOOK_DELETED"


class AvailabilityStatus(str, enum.Enum):
    AVAILABLE = "AVAILABLE"
    DEGRADED = "DEGRADED"
    UNAVAILABLE = "UNAVAILABLE"
    UNKNOWN = "UNKNOWN"


class ProviderName(str, enum.Enum):
    OPENAI = "OPENAI"
    ANTHROPIC = "ANTHROPIC"
    GOOGLE = "GOOGLE"
    OLLAMA = "OLLAMA"
    COHERE = "COHERE"
    MISTRAL = "MISTRAL"


class RequestStatus(str, enum.Enum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CACHED = "CACHED"
    RATE_LIMITED = "RATE_LIMITED"
    BUDGET_EXCEEDED = "BUDGET_EXCEEDED"


class ComplexityLevel(str, enum.Enum):
    SIMPLE = "SIMPLE"
    MEDIUM = "MEDIUM"
    COMPLEX = "COMPLEX"


class CircuitBreakerState(str, enum.Enum):
    CLOSED = "CLOSED"
    OPEN = "OPEN"
    HALF_OPEN = "HALF_OPEN"


class WebhookStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"
    FAILED = "FAILED"


class WebhookDeliveryStatus(str, enum.Enum):
    PENDING = "PENDING"
    DELIVERED = "DELIVERED"
    FAILED = "FAILED"
    RETRYING = "RETRYING"


class QualityTier(str, enum.Enum):
    ECONOMY = "ECONOMY"
    STANDARD = "STANDARD"
    PREMIUM = "PREMIUM"


UserRolePG = pg_enum(UserRole)
WorkspaceMemberRolePG = pg_enum(WorkspaceMemberRole)
ApiKeyStatusPG = pg_enum(ApiKeyStatus)
PlanTierPG = pg_enum(PlanTier)
BudgetPeriodPG = pg_enum(BudgetPeriod)
AlertSeverityPG = pg_enum(AlertSeverity)
AlertStatusPG = pg_enum(AlertStatus)
LoadBalancingStrategyPG = pg_enum(LoadBalancingStrategy)
NotificationTypePG = pg_enum(NotificationType)
AuditActionPG = pg_enum(AuditAction)
AvailabilityStatusPG = pg_enum(AvailabilityStatus)
ProviderNamePG = pg_enum(ProviderName)
RequestStatusPG = pg_enum(RequestStatus)
ComplexityLevelPG = pg_enum(ComplexityLevel)
CircuitBreakerStatePG = pg_enum(CircuitBreakerState)
WebhookStatusPG = pg_enum(WebhookStatus)
WebhookDeliveryStatusPG = pg_enum(WebhookDeliveryStatus)
QualityTierPG = pg_enum(QualityTier)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String, unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column("hashed_password", String)
    name: Mapped[str] = mapped_column(String)
    avatar_url: Mapped[str | None] = mapped_column("avatar_url", String, nullable=True)
    role: Mapped[str] = mapped_column(UserRolePG, default=UserRole.USER.value)
    email_verified: Mapped[bool] = mapped_column("email_verified", Boolean, default=False)
    email_verification_token_hash: Mapped[str | None] = mapped_column(
        "email_verification_token_hash", String, nullable=True
    )
    email_verification_expires_at: Mapped[datetime | None] = mapped_column(
        "email_verification_expires_at", DateTime(timezone=True), nullable=True
    )
    password_reset_token_hash: Mapped[str | None] = mapped_column(
        "password_reset_token_hash", String, nullable=True
    )
    password_reset_expires_at: Mapped[datetime | None] = mapped_column(
        "password_reset_expires_at", DateTime(timezone=True), nullable=True
    )
    mfa_enabled: Mapped[bool] = mapped_column("mfa_enabled", Boolean, default=False)
    mfa_secret_encrypted: Mapped[str | None] = mapped_column("mfa_secret_encrypted", String, nullable=True)
    mfa_backup_codes_hash: Mapped[Any | None] = mapped_column("mfa_backup_codes_hash", JSON, nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column("last_login_at", DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        "updated_at",
        DateTime(timezone=True),
        server_default=func.now(),
        default=func.now(),
        onupdate=func.now(),
    )
    deleted_at: Mapped[datetime | None] = mapped_column("deleted_at", DateTime(timezone=True), nullable=True)

    refresh_tokens: Mapped[list[RefreshToken]] = relationship(back_populates="user")
    workspace_memberships: Mapped[list[WorkspaceMember]] = relationship(back_populates="user")
    api_keys: Mapped[list[ApiKey]] = relationship(back_populates="created_by")
    audit_logs: Mapped[list[AuditLog]] = relationship(back_populates="user")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    token: Mapped[str] = mapped_column(String, unique=True, index=True)
    user_id: Mapped[str] = mapped_column("user_id", UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"))
    expires_at: Mapped[datetime] = mapped_column("expires_at", DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())
    revoked_at: Mapped[datetime | None] = mapped_column("revoked_at", DateTime(timezone=True), nullable=True)
    user_agent: Mapped[str | None] = mapped_column("user_agent", String, nullable=True)
    ip_address: Mapped[str | None] = mapped_column("ip_address", String, nullable=True)

    user: Mapped[User] = relationship(back_populates="refresh_tokens")


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    slug: Mapped[str] = mapped_column(String, unique=True, index=True)
    name: Mapped[str] = mapped_column(String)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    logo_url: Mapped[str | None] = mapped_column("logo_url", String, nullable=True)
    plan: Mapped[str] = mapped_column(PlanTierPG, default=PlanTier.FREE.value)
    stripe_customer_id: Mapped[str | None] = mapped_column("stripe_customer_id", String, unique=True, nullable=True)
    is_active: Mapped[bool] = mapped_column("is_active", Boolean, default=True)
    default_routing_strategy: Mapped[str] = mapped_column(
        "default_routing_strategy", LoadBalancingStrategyPG, default=LoadBalancingStrategy.COST_OPTIMIZED.value
    )
    allowed_providers: Mapped[list[str] | None] = mapped_column(
        "allowed_providers", ARRAY(ProviderNamePG), nullable=True
    )
    semantic_cache_enabled: Mapped[bool] = mapped_column("semantic_cache_enabled", Boolean, default=True)
    cache_threshold: Mapped[float] = mapped_column("cache_threshold", Float, default=0.92)
    requests_per_minute: Mapped[int | None] = mapped_column("requests_per_minute", Integer, nullable=True)
    tokens_per_minute: Mapped[int | None] = mapped_column("tokens_per_minute", Integer, nullable=True)
    requests_per_day: Mapped[int | None] = mapped_column("requests_per_day", Integer, nullable=True)
    sso_enabled: Mapped[bool] = mapped_column("sso_enabled", Boolean, default=False)
    sso_metadata_url: Mapped[str | None] = mapped_column("sso_metadata_url", String, nullable=True)
    sso_entity_id: Mapped[str | None] = mapped_column("sso_entity_id", String, nullable=True)
    sso_idp_sso_url: Mapped[str | None] = mapped_column("sso_idp_sso_url", String, nullable=True)
    sso_idp_cert_pem: Mapped[str | None] = mapped_column("sso_idp_cert_pem", Text, nullable=True)
    scim_enabled: Mapped[bool] = mapped_column("scim_enabled", Boolean, default=False)
    scim_token_hash: Mapped[str | None] = mapped_column("scim_token_hash", String, unique=True, nullable=True)
    scim_token_prefix: Mapped[str | None] = mapped_column("scim_token_prefix", String, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        "updated_at",
        DateTime(timezone=True),
        server_default=func.now(),
        default=func.now(),
        onupdate=func.now(),
    )
    deleted_at: Mapped[datetime | None] = mapped_column("deleted_at", DateTime(timezone=True), nullable=True)

    members: Mapped[list[WorkspaceMember]] = relationship(back_populates="workspace")
    api_keys: Mapped[list[ApiKey]] = relationship(back_populates="workspace")
    budgets: Mapped[list[Budget]] = relationship(back_populates="workspace")
    audit_logs: Mapped[list[AuditLog]] = relationship(back_populates="workspace")
    notifications: Mapped[list[Notification]] = relationship(back_populates="workspace")
    rate_limits: Mapped[list[RateLimit]] = relationship(back_populates="workspace")


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"
    __table_args__ = (UniqueConstraint("workspace_id", "user_id"),)

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(
        "workspace_id", UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE")
    )
    user_id: Mapped[str] = mapped_column("user_id", UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(WorkspaceMemberRolePG, default=WorkspaceMemberRole.MEMBER.value)
    invited_by: Mapped[str | None] = mapped_column("invited_by", UUID(as_uuid=False), nullable=True)
    joined_at: Mapped[datetime] = mapped_column("joined_at", DateTime(timezone=True), server_default=func.now())
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        "updated_at",
        DateTime(timezone=True),
        server_default=func.now(),
        default=func.now(),
        onupdate=func.now(),
    )

    workspace: Mapped[Workspace] = relationship(back_populates="members")
    user: Mapped[User] = relationship(back_populates="workspace_memberships")


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(
        "workspace_id", UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE")
    )
    created_by_id: Mapped[str] = mapped_column("created_by_id", UUID(as_uuid=False), ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String)
    key_hash: Mapped[str] = mapped_column("key_hash", String, unique=True)
    key_prefix: Mapped[str] = mapped_column("key_prefix", String)
    status: Mapped[str] = mapped_column(ApiKeyStatusPG, default=ApiKeyStatus.ACTIVE.value)
    expires_at: Mapped[datetime | None] = mapped_column("expires_at", DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column("last_used_at", DateTime(timezone=True), nullable=True)
    last_used_ip: Mapped[str | None] = mapped_column("last_used_ip", String, nullable=True)
    request_count: Mapped[int] = mapped_column("request_count", BigInteger, default=0)
    scopes: Mapped[list[str]] = mapped_column(ARRAY(String), default=["chat:write", "analytics:read"])
    rate_limit_rpm: Mapped[int | None] = mapped_column("rate_limit_rpm", Integer, nullable=True)
    rate_limit_tpm: Mapped[int | None] = mapped_column("rate_limit_tpm", Integer, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column("revoked_at", DateTime(timezone=True), nullable=True)
    revoked_by: Mapped[str | None] = mapped_column("revoked_by", UUID(as_uuid=False), nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        "updated_at",
        DateTime(timezone=True),
        server_default=func.now(),
        default=func.now(),
        onupdate=func.now(),
    )

    workspace: Mapped[Workspace] = relationship(back_populates="api_keys")
    created_by: Mapped[User] = relationship(back_populates="api_keys")


class Budget(Base):
    __tablename__ = "budgets"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(
        "workspace_id", UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String)
    limit_usd: Mapped[float] = mapped_column("limit_usd", Float)
    period: Mapped[str] = mapped_column(BudgetPeriodPG)
    current_spend: Mapped[float] = mapped_column("current_spend", Float, default=0)
    period_start_at: Mapped[datetime] = mapped_column("period_start_at", DateTime(timezone=True))
    period_end_at: Mapped[datetime] = mapped_column("period_end_at", DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column("is_active", Boolean, default=True)
    auto_renew: Mapped[bool] = mapped_column("auto_renew", Boolean, default=True)
    alert_at_80: Mapped[bool] = mapped_column("alert_at_80", Boolean, default=True)
    alert_at_90: Mapped[bool] = mapped_column("alert_at_90", Boolean, default=True)
    block_at_100: Mapped[bool] = mapped_column("block_at_100", Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        "updated_at",
        DateTime(timezone=True),
        server_default=func.now(),
        default=func.now(),
        onupdate=func.now(),
    )

    workspace: Mapped[Workspace] = relationship(back_populates="budgets")
    budget_alerts: Mapped[list[BudgetAlert]] = relationship(back_populates="budget")


class BudgetAlert(Base):
    __tablename__ = "budget_alerts"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(
        "workspace_id", UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE")
    )
    budget_id: Mapped[str] = mapped_column("budget_id", UUID(as_uuid=False), ForeignKey("budgets.id", ondelete="CASCADE"))
    severity: Mapped[str] = mapped_column(AlertSeverityPG)
    status: Mapped[str] = mapped_column(AlertStatusPG, default=AlertStatus.PENDING.value)
    threshold: Mapped[float] = mapped_column(Float)
    spend_at_alert: Mapped[float] = mapped_column("spend_at_alert", Float)
    message: Mapped[str] = mapped_column(String)
    sent_at: Mapped[datetime | None] = mapped_column("sent_at", DateTime(timezone=True), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column("resolved_at", DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())

    budget: Mapped[Budget] = relationship(back_populates="budget_alerts")


class RateLimit(Base):
    __tablename__ = "rate_limits"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(
        "workspace_id", UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE"), unique=True
    )
    plan: Mapped[str] = mapped_column(PlanTierPG)
    requests_per_minute: Mapped[int] = mapped_column("requests_per_minute", Integer)
    requests_per_hour: Mapped[int] = mapped_column("requests_per_hour", Integer)
    requests_per_day: Mapped[int] = mapped_column("requests_per_day", Integer)
    tokens_per_minute: Mapped[int] = mapped_column("tokens_per_minute", Integer)
    tokens_per_day: Mapped[int] = mapped_column("tokens_per_day", BigInteger)
    is_active: Mapped[bool] = mapped_column("is_active", Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        "updated_at",
        DateTime(timezone=True),
        server_default=func.now(),
        default=func.now(),
        onupdate=func.now(),
    )

    workspace: Mapped[Workspace] = relationship(back_populates="rate_limits")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    workspace_id: Mapped[str | None] = mapped_column(
        "workspace_id", UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="SET NULL"), nullable=True
    )
    user_id: Mapped[str | None] = mapped_column(
        "user_id", UUID(as_uuid=False), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(AuditActionPG)
    resource_type: Mapped[str | None] = mapped_column("resource_type", String, nullable=True)
    resource_id: Mapped[str | None] = mapped_column("resource_id", String, nullable=True)
    metadata_: Mapped[Any | None] = mapped_column("metadata", JSON, nullable=True)
    ip_address: Mapped[str | None] = mapped_column("ip_address", String, nullable=True)
    user_agent: Mapped[str | None] = mapped_column("user_agent", String, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())

    workspace: Mapped[Workspace | None] = relationship(back_populates="audit_logs")
    user: Mapped[User | None] = relationship(back_populates="audit_logs")


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    workspace_id: Mapped[str | None] = mapped_column(
        "workspace_id", UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True
    )
    user_id: Mapped[str | None] = mapped_column(
        "user_id", UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    type: Mapped[str] = mapped_column(NotificationTypePG)
    title: Mapped[str] = mapped_column(String)
    body: Mapped[str] = mapped_column(String)
    metadata_: Mapped[Any | None] = mapped_column("metadata", JSON, nullable=True)
    read_at: Mapped[datetime | None] = mapped_column("read_at", DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())

    workspace: Mapped[Workspace | None] = relationship(back_populates="notifications")


class ModelRegistry(Base):
    __tablename__ = "model_registry"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    provider: Mapped[str] = mapped_column(ProviderNamePG)
    model_id: Mapped[str] = mapped_column("model_id", String)
    display_name: Mapped[str] = mapped_column("display_name", String)

    provider_health: Mapped[list[ProviderHealth]] = relationship(back_populates="model")
    requests: Mapped[list["GatewayRequest"]] = relationship(back_populates="model")
    provider_logs: Mapped[list["ProviderLog"]] = relationship(back_populates="model")


class ProviderHealth(Base):
    __tablename__ = "provider_health"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    model_registry_id: Mapped[str] = mapped_column(
        "model_registry_id", UUID(as_uuid=False), ForeignKey("model_registry.id")
    )
    status: Mapped[str] = mapped_column(AvailabilityStatusPG)
    latency_ms: Mapped[int | None] = mapped_column("latency_ms", Integer, nullable=True)
    status_code: Mapped[int | None] = mapped_column("status_code", Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column("error_message", String, nullable=True)
    checked_at: Mapped[datetime] = mapped_column("checked_at", DateTime(timezone=True), server_default=func.now())

    model: Mapped[ModelRegistry] = relationship(back_populates="provider_health")


class GatewayRequest(Base):
    __tablename__ = "requests"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    trace_id: Mapped[str] = mapped_column("trace_id", UUID(as_uuid=False))
    workspace_id: Mapped[str] = mapped_column("workspace_id", UUID(as_uuid=False), ForeignKey("workspaces.id"))
    api_key_id: Mapped[str] = mapped_column("api_key_id", UUID(as_uuid=False), ForeignKey("api_keys.id"))
    model_registry_id: Mapped[str | None] = mapped_column(
        "model_registry_id", UUID(as_uuid=False), ForeignKey("model_registry.id"), nullable=True
    )
    status: Mapped[str] = mapped_column(RequestStatusPG, default=RequestStatus.PENDING.value)
    prompt: Mapped[str] = mapped_column(Text)
    system_prompt: Mapped[str | None] = mapped_column("system_prompt", Text, nullable=True)
    requested_model: Mapped[str | None] = mapped_column("requested_model", String, nullable=True)
    response: Mapped[str | None] = mapped_column(Text, nullable=True)
    finish_reason: Mapped[str | None] = mapped_column("finish_reason", String, nullable=True)
    input_tokens: Mapped[int | None] = mapped_column("input_tokens", Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column("output_tokens", Integer, nullable=True)
    total_tokens: Mapped[int | None] = mapped_column("total_tokens", Integer, nullable=True)
    actual_cost_usd: Mapped[float | None] = mapped_column("actual_cost_usd", Float, nullable=True)
    baseline_cost_usd: Mapped[float | None] = mapped_column("baseline_cost_usd", Float, nullable=True)
    savings_usd: Mapped[float | None] = mapped_column("savings_usd", Float, nullable=True)
    total_latency_ms: Mapped[int | None] = mapped_column("total_latency_ms", Integer, nullable=True)
    cache_hit: Mapped[bool] = mapped_column("cache_hit", Boolean, default=False)
    complexity_level: Mapped[str | None] = mapped_column("complexity_level", ComplexityLevelPG, nullable=True)
    retry_count: Mapped[int] = mapped_column("retry_count", Integer, default=0)
    fallback_used: Mapped[bool] = mapped_column("fallback_used", Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        "updated_at",
        DateTime(timezone=True),
        server_default=func.now(),
        default=func.now(),
        onupdate=func.now(),
    )

    model: Mapped[ModelRegistry | None] = relationship(back_populates="requests")
    provider_logs: Mapped[list[ProviderLog]] = relationship(back_populates="request")
    fallback_events: Mapped[list[FallbackEvent]] = relationship(back_populates="request")


class ProviderLog(Base):
    __tablename__ = "provider_logs"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    request_id: Mapped[str] = mapped_column("request_id", UUID(as_uuid=False), ForeignKey("requests.id", ondelete="CASCADE"))
    model_registry_id: Mapped[str] = mapped_column("model_registry_id", UUID(as_uuid=False), ForeignKey("model_registry.id"))
    success: Mapped[bool] = mapped_column(Boolean)
    cost_usd: Mapped[float | None] = mapped_column("cost_usd", Float, nullable=True)
    latency_ms: Mapped[int | None] = mapped_column("latency_ms", Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())

    request: Mapped[GatewayRequest] = relationship(back_populates="provider_logs")
    model: Mapped[ModelRegistry] = relationship(back_populates="provider_logs")


class FallbackEvent(Base):
    __tablename__ = "fallback_events"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    request_id: Mapped[str] = mapped_column("request_id", UUID(as_uuid=False), ForeignKey("requests.id", ondelete="CASCADE"))
    failed_provider: Mapped[str] = mapped_column("failed_provider", ProviderNamePG)
    fallback_provider: Mapped[str] = mapped_column("fallback_provider", ProviderNamePG)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())

    request: Mapped[GatewayRequest] = relationship(back_populates="fallback_events")


class CircuitBreakerEvent(Base):
    __tablename__ = "circuit_breaker_events"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    provider: Mapped[str] = mapped_column(ProviderNamePG)
    model_id: Mapped[str] = mapped_column("model_id", String)
    from_state: Mapped[str] = mapped_column("from_state", CircuitBreakerStatePG)
    to_state: Mapped[str] = mapped_column("to_state", CircuitBreakerStatePG)
    reason: Mapped[str] = mapped_column(String)
    failure_count: Mapped[int] = mapped_column("failure_count", Integer)
    success_count: Mapped[int] = mapped_column("success_count", Integer, default=0)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())


class UsageMetric(Base):
    __tablename__ = "usage_metrics"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    workspace_id: Mapped[str | None] = mapped_column(
        "workspace_id", UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True
    )
    metric_name: Mapped[str] = mapped_column("metric_name", String)
    metric_value: Mapped[float] = mapped_column("metric_value", Float)
    labels: Mapped[Any | None] = mapped_column(JSON, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column("recorded_at", DateTime(timezone=True), server_default=func.now())


class SpendingAnalytic(Base):
    __tablename__ = "spending_analytics"
    __table_args__ = (UniqueConstraint("workspace_id", "date", "provider"),)

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column("workspace_id", UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE"))
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    provider: Mapped[str | None] = mapped_column(ProviderNamePG, nullable=True)
    total_requests: Mapped[int] = mapped_column("total_requests", Integer, default=0)
    actual_cost_usd: Mapped[float] = mapped_column("actual_cost_usd", Float, default=0)
    baseline_cost_usd: Mapped[float] = mapped_column("baseline_cost_usd", Float, default=0)
    total_savings_usd: Mapped[float] = mapped_column("total_savings_usd", Float, default=0)
    avg_latency_ms: Mapped[float | None] = mapped_column("avg_latency_ms", Float, nullable=True)
    cache_hit_rate: Mapped[float | None] = mapped_column("cache_hit_rate", Float, nullable=True)
    error_rate: Mapped[float | None] = mapped_column("error_rate", Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        "updated_at",
        DateTime(timezone=True),
        server_default=func.now(),
        default=func.now(),
        onupdate=func.now(),
    )


class HealthCheck(Base):
    __tablename__ = "health_checks"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    service: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String)
    latency_ms: Mapped[int | None] = mapped_column("latency_ms", Integer, nullable=True)
    details: Mapped[Any | None] = mapped_column(JSON, nullable=True)
    checked_at: Mapped[datetime] = mapped_column("checked_at", DateTime(timezone=True), server_default=func.now())


class Webhook(Base):
    __tablename__ = "webhooks"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column("workspace_id", UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String)
    url: Mapped[str] = mapped_column(String)
    signing_secret: Mapped[str] = mapped_column("signing_secret", String)
    events: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    status: Mapped[str] = mapped_column(WebhookStatusPG, default=WebhookStatus.ACTIVE.value)
    failure_count: Mapped[int] = mapped_column("failure_count", Integer, default=0)
    last_triggered_at: Mapped[datetime | None] = mapped_column("last_triggered_at", DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        "updated_at",
        DateTime(timezone=True),
        server_default=func.now(),
        default=func.now(),
        onupdate=func.now(),
    )

    deliveries: Mapped[list[WebhookDelivery]] = relationship(back_populates="webhook")


class WebhookDelivery(Base):
    __tablename__ = "webhook_deliveries"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    webhook_id: Mapped[str] = mapped_column("webhook_id", UUID(as_uuid=False), ForeignKey("webhooks.id", ondelete="CASCADE"))
    workspace_id: Mapped[str] = mapped_column("workspace_id", UUID(as_uuid=False))
    event: Mapped[str] = mapped_column(String)
    payload: Mapped[Any] = mapped_column(JSON)
    response_status: Mapped[int | None] = mapped_column("response_status", Integer, nullable=True)
    response_body: Mapped[str | None] = mapped_column("response_body", Text, nullable=True)
    status: Mapped[str] = mapped_column(WebhookDeliveryStatusPG, default=WebhookDeliveryStatus.PENDING.value)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_retry_at: Mapped[datetime | None] = mapped_column("next_retry_at", DateTime(timezone=True), nullable=True)
    latency_ms: Mapped[int | None] = mapped_column("latency_ms", Integer, nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column("delivered_at", DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())

    webhook: Mapped[Webhook] = relationship(back_populates="deliveries")


class CacheEntry(Base):
    __tablename__ = "cache_entries"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    expires_at: Mapped[datetime] = mapped_column("expires_at", DateTime(timezone=True))
