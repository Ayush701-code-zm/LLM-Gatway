"""Application settings."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _env_files() -> tuple[str, ...]:
    root = Path(__file__).resolve().parents[3]
    files: list[str] = []
    for candidate in (root / ".env", root / "apps" / "api-python" / ".env"):
        if candidate.exists():
            files.append(str(candidate))
    return tuple(files)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_env_files(),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    node_env: str = Field(default="development", alias="NODE_ENV")
    app_name: str = Field(default="SmartRoute AI", alias="APP_NAME")
    app_version: str = Field(default="0.1.0", alias="APP_VERSION")

    api_port: int = Field(default=3001, alias="API_PORT")
    api_host: str = Field(default="0.0.0.0", alias="API_HOST")
    api_base_url: str = Field(default="http://localhost:3001", alias="API_BASE_URL")

    database_url: str = Field(
        default="postgresql://postgres:postgres@localhost:5432/smartroute",
        alias="DATABASE_URL",
    )
    direct_url: str | None = Field(default=None, alias="DIRECT_URL")

    redis_url: str = Field(default="redis://localhost:6379", alias="REDIS_URL")
    redis_password: str | None = Field(default=None, alias="REDIS_PASSWORD")
    redis_db: int = Field(default=0, alias="REDIS_DB")

    jwt_secret: str = Field(default="dev-jwt-secret-dev-jwt-secret-dev-jwt!", alias="JWT_SECRET")
    jwt_expires_in: str = Field(default="15m", alias="JWT_EXPIRES_IN")
    jwt_refresh_secret: str = Field(default="dev-jwt-refresh-secret-dev-jwt-refresh!", alias="JWT_REFRESH_SECRET")
    jwt_refresh_expires_in: str = Field(default="7d", alias="JWT_REFRESH_EXPIRES_IN")
    api_key_encryption_secret: str = Field(
        default="dev-api-key-encryption-secret-key!!",
        alias="API_KEY_ENCRYPTION_SECRET",
    )

    openai_api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")
    anthropic_api_key: str | None = Field(default=None, alias="ANTHROPIC_API_KEY")
    google_generative_ai_api_key: str | None = Field(default=None, alias="GOOGLE_GENERATIVE_AI_API_KEY")
    cohere_api_key: str | None = Field(default=None, alias="COHERE_API_KEY")
    mistral_api_key: str | None = Field(default=None, alias="MISTRAL_API_KEY")
    ollama_base_url: str = Field(default="http://localhost:11434", alias="OLLAMA_BASE_URL")

    semantic_cache_threshold: float = Field(default=0.92, alias="SEMANTIC_CACHE_THRESHOLD")
    cache_ttl_seconds: int = Field(default=3600, alias="CACHE_TTL_SECONDS")
    embedding_model: str = Field(default="text-embedding-3-small", alias="EMBEDDING_MODEL")

    rate_limit_window_ms: int = Field(default=60_000, alias="RATE_LIMIT_WINDOW_MS")
    rate_limit_max_requests: int = Field(default=100, alias="RATE_LIMIT_MAX_REQUESTS")
    max_inflight_requests: int = Field(default=500, alias="MAX_INFLIGHT_REQUESTS")

    log_level: str = Field(default="info", alias="LOG_LEVEL")
    prometheus_port: int = Field(default=9091, alias="PROMETHEUS_PORT")
    cors_origins: str = Field(default="http://localhost:3000", alias="CORS_ORIGINS")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
