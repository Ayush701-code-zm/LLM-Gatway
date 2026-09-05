"""Application configuration from environment variables."""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    NODE_ENV: str = "development"
    APP_NAME: str = "SmartRoute AI"
    APP_VERSION: str = "0.1.0"

    API_PORT: int = 3001
    API_HOST: str = "0.0.0.0"
    API_BASE_URL: str = "http://localhost:3001"

    DIRECT_URL: str | None = None

    REDIS_URL: str = "redis://localhost:6379"
    REDIS_PASSWORD: str | None = None
    REDIS_DB: int = 0

    JWT_SECRET: str = Field(default="dev-jwt-secret-dev-jwt-secret-dev-jwt!", min_length=32)
    JWT_EXPIRES_IN: str = "15m"
    JWT_REFRESH_SECRET: str = Field(default="dev-jwt-refresh-secret-dev-jwt-refresh!", min_length=32)
    JWT_REFRESH_EXPIRES_IN: str = "7d"

    API_KEY_ENCRYPTION_SECRET: str = Field(default="dev-api-key-encryption-secret-key!!", min_length=32)

    SMTP_HOST: str | None = None
    SMTP_PORT: int = 587
    SMTP_USER: str | None = None
    SMTP_PASS: str | None = None
    EMAIL_FROM: str | None = None
    REQUIRE_EMAIL_VERIFICATION: bool = False

    GOOGLE_CLIENT_ID: str | None = None
    GOOGLE_CLIENT_SECRET: str | None = None
    OAUTH_REDIRECT_URI: str | None = None
    OAUTH_E2E_BYPASS: bool = False

    LOG_LEVEL: str = "info"
    CORS_ORIGINS: str = "http://localhost:3000"

    OPENAI_API_KEY: str | None = None
    ANTHROPIC_API_KEY: str | None = None
    GOOGLE_GENERATIVE_AI_API_KEY: str | None = None
    COHERE_API_KEY: str | None = None
    MISTRAL_API_KEY: str | None = None
    OLLAMA_BASE_URL: str = "http://localhost:11434"

    SEMANTIC_CACHE_THRESHOLD: float = 0.92
    CACHE_TTL_SECONDS: int = 3600
    EMBEDDING_MODEL: str = "text-embedding-3-small"
    MAX_INFLIGHT_REQUESTS: int = 500

    STRIPE_SECRET_KEY: str | None = None
    STRIPE_WEBHOOK_SECRET: str | None = None
    STRIPE_PRICE_PRO: str | None = None
    STRIPE_PRICE_ENTERPRISE: str | None = None

    SAML_E2E_BYPASS: bool = False

    QUEUE_CONCURRENCY_ANALYTICS: int = 5
    QUEUE_CONCURRENCY_HEALTH_CHECKS: int = 2

    DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/smartroute"

    @field_validator("REQUIRE_EMAIL_VERIFICATION", mode="before")
    @classmethod
    def parse_bool(cls, v: object) -> bool:
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            return v.lower() == "true"
        return bool(v)

    @field_validator("OAUTH_E2E_BYPASS", mode="before")
    @classmethod
    def parse_oauth_e2e(cls, v: object) -> bool:
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            return v.lower() == "true"
        return bool(v)

    @field_validator("SAML_E2E_BYPASS", mode="before")
    @classmethod
    def parse_saml_e2e(cls, v: object) -> bool:
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            return v.lower() == "true"
        return bool(v)

    @property
    def async_database_url(self) -> str:
        from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

        url = self.DATABASE_URL
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        elif url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+asyncpg://", 1)

        parsed = urlparse(url)
        if parsed.query:
            params = parse_qs(parsed.query, keep_blank_values=True)
            # Prisma uses ?schema=public — asyncpg does not accept this connect arg
            params.pop("schema", None)
            params.pop("connection_limit", None)
            params.pop("pool_timeout", None)
            query = urlencode({k: v[0] for k, v in params.items() if v and v[0] != ""})
            url = urlunparse(parsed._replace(query=query))

        return url

    @property
    def web_base_url(self) -> str:
        return self.API_BASE_URL.replace(":3001", ":3000")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
