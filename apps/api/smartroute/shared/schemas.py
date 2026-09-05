"""Pydantic schemas mirroring @smartroute/shared API types."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=32000)
    system_prompt: str | None = Field(default=None, max_length=8000, alias="systemPrompt")
    model: str = "auto"
    stream: bool = False
    max_tokens: int | None = Field(default=None, ge=1, le=32000, alias="maxTokens")
    temperature: float | None = Field(default=None, ge=0, le=2)
    metadata: dict[str, str] | None = None

    model_config = {"populate_by_name": True}


class EmbeddingsRequest(BaseModel):
    input: str | list[str]
    model: str | None = None


class CreateModelRequest(BaseModel):
    provider: str
    model_id: str = Field(alias="modelId")
    display_name: str = Field(alias="displayName")
    description: str | None = None
    input_cost_per_million: float = Field(alias="inputCostPerMillion", ge=0)
    output_cost_per_million: float = Field(alias="outputCostPerMillion", ge=0)
    context_window: int = Field(alias="contextWindow", gt=0)
    max_output_tokens: int = Field(alias="maxOutputTokens", gt=0)
    supports_streaming: bool = Field(default=True, alias="supportsStreaming")
    supports_vision: bool = Field(default=False, alias="supportsVision")
    supports_functions: bool = Field(default=False, alias="supportsFunctions")
    supports_embeddings: bool = Field(default=False, alias="supportsEmbeddings")
    quality_tier: str = Field(alias="qualityTier")
    complexity_min_level: str = Field(alias="complexityMinLevel")
    is_enabled: bool = Field(default=True, alias="isEnabled")

    model_config = {"populate_by_name": True}


class PatchModelRequest(BaseModel):
    display_name: str | None = Field(default=None, alias="displayName")
    description: str | None = None
    input_cost_per_million: float | None = Field(default=None, alias="inputCostPerMillion", ge=0)
    output_cost_per_million: float | None = Field(default=None, alias="outputCostPerMillion", ge=0)
    context_window: int | None = Field(default=None, alias="contextWindow", gt=0)
    max_output_tokens: int | None = Field(default=None, alias="maxOutputTokens", gt=0)
    supports_streaming: bool | None = Field(default=None, alias="supportsStreaming")
    supports_vision: bool | None = Field(default=None, alias="supportsVision")
    supports_functions: bool | None = Field(default=None, alias="supportsFunctions")
    supports_embeddings: bool | None = Field(default=None, alias="supportsEmbeddings")
    quality_tier: str | None = Field(default=None, alias="qualityTier")
    complexity_min_level: str | None = Field(default=None, alias="complexityMinLevel")
    is_enabled: bool | None = Field(default=None, alias="isEnabled")
    availability_status: str | None = Field(default=None, alias="availabilityStatus")

    model_config = {"populate_by_name": True}


class ApiError(BaseModel):
    code: str
    message: str
    details: Any | None = None
    request_id: str | None = Field(default=None, alias="requestId")

    model_config = {"populate_by_name": True}


class ApiResponse(BaseModel):
    success: bool
    data: Any | None = None
    error: ApiError | None = None
