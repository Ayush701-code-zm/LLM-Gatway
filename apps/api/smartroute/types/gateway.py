"""Gateway domain types."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal


ComplexityLevel = Literal["SIMPLE", "MEDIUM", "COMPLEX"]
CircuitState = Literal["CLOSED", "OPEN", "HALF_OPEN"]


@dataclass
class ApiKeyContext:
    id: str
    workspace_id: str
    scopes: list[str]


@dataclass
class LLMMessage:
    role: Literal["system", "user", "assistant"]
    content: str


@dataclass
class LLMRequest:
    messages: list[LLMMessage]
    model: str
    max_tokens: int | None = None
    temperature: float | None = None
    stream: bool = False


@dataclass
class LLMResponse:
    content: str
    input_tokens: int
    output_tokens: int
    finish_reason: str
    latency_ms: int
    model: str
    provider: str
    raw_response: Any | None = None


@dataclass
class LLMStreamChunk:
    content: str
    done: bool
    finish_reason: str | None = None


@dataclass
class ProviderHealthResult:
    provider: str
    model: str
    status: Literal["available", "degraded", "unavailable"]
    latency_ms: int
    error_message: str | None = None


@dataclass
class RoutingContext:
    workspace_id: str
    prompt: str
    requested_model: str
    stream: bool = False


@dataclass
class CandidateModel:
    provider: str
    model_id: str
    estimated_cost_usd: float
    reason: str
    selected: bool


@dataclass
class RoutingResult:
    provider: str
    model_id: str
    model_registry_id: str
    complexity_level: str
    complexity_score: float
    strategy: str
    selection_reason: str
    estimated_cost_usd: float
    decision_latency_ms: int
    candidate_models: list[CandidateModel]


@dataclass
class CacheCheckResult:
    hit: bool
    latency_ms: int
    response: str | None = None
    cache_entry_id: str | None = None
    similarity_score: float | None = None
    savings_usd: float | None = None


@dataclass
class CircuitBreakerStatus:
    state: CircuitState
    failure_count: int
    success_count: int
    last_failure_at: datetime | None = None
    next_attempt_at: datetime | None = None


@dataclass
class RateLimitInfo:
    limit_rpm: int
    limit_rpd: int
    used_rpm: int
    used_rpd: int
    remaining_rpm: int
    remaining_rpd: int
    reset_rpm: int
    reset_rpd: int


@dataclass
class ModelRegistryRow:
    id: str
    provider: str
    model_id: str
    display_name: str
    description: str | None
    input_cost_per_million: float
    output_cost_per_million: float
    context_window: int
    max_output_tokens: int
    supports_streaming: bool
    supports_vision: bool
    supports_functions: bool
    supports_embeddings: bool
    quality_tier: str
    complexity_min_level: str
    availability_status: str
    avg_latency_ms: float | None
    p95_latency_ms: float | None
    success_rate: float | None
    is_enabled: bool
    updated_at: datetime | None = None


@dataclass
class WorkspaceRoutingConfig:
    default_routing_strategy: str
    allowed_providers: list[str]
    semantic_cache_enabled: bool
    cache_threshold: float


@dataclass
class GatewayRequestState:
    request_id: str
    trace_id: str
    api_key: ApiKeyContext
    rate_limit_info: RateLimitInfo | None = None
    prompt_injection_score: float | None = None
    prompt_injection_signals: list[str] = field(default_factory=list)
