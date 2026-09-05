"""Shared constants mirroring @smartroute/shared."""

PLAN_LIMITS = {
    "FREE": {
        "requests_per_minute": 10,
        "requests_per_hour": 100,
        "requests_per_day": 500,
        "tokens_per_minute": 50_000,
        "tokens_per_day": 1_000_000,
        "max_workspace_members": 1,
        "max_api_keys": 2,
        "budget_limit_usd": 10,
    },
    "PRO": {
        "requests_per_minute": 60,
        "requests_per_hour": 1_000,
        "requests_per_day": 10_000,
        "tokens_per_minute": 500_000,
        "tokens_per_day": 10_000_000,
        "max_workspace_members": 10,
        "max_api_keys": 20,
        "budget_limit_usd": 500,
    },
    "ENTERPRISE": {
        "requests_per_minute": 1_000,
        "requests_per_hour": 50_000,
        "requests_per_day": 500_000,
        "tokens_per_minute": 5_000_000,
        "tokens_per_day": 100_000_000,
        "max_workspace_members": -1,
        "max_api_keys": -1,
        "budget_limit_usd": -1,
    },
}

BUDGET_THRESHOLDS = {
    "WARNING": 0.8,
    "CRITICAL": 0.9,
    "BLOCKED": 1.0,
}

CACHE_DEFAULTS = {
    "SIMILARITY_THRESHOLD": 0.92,
    "TTL_SECONDS": 3600,
    "EMBEDDING_DIMENSIONS": 1536,
    "EMBEDDING_MODEL": "text-embedding-3-small",
}

CIRCUIT_BREAKER = {
    "FAILURE_THRESHOLD": 5,
    "SUCCESS_THRESHOLD": 2,
    "TIMEOUT_MS": 60_000,
    "HALF_OPEN_MAX_CALLS": 3,
}

RETRY_CONFIG = {
    "MAX_ATTEMPTS": 3,
    "BASE_DELAY_MS": 1_000,
    "MAX_DELAY_MS": 10_000,
    "JITTER_FACTOR": 0.2,
    "RETRYABLE_STATUS_CODES": [429, 500, 502, 503, 504],
    "NON_RETRYABLE_STATUS_CODES": [400, 401, 403, 404, 422],
}

COMPLEXITY_THRESHOLDS = {
    "SIMPLE_MAX_SCORE": 0.12,
    "MEDIUM_MAX_SCORE": 0.40,
}

API_VERSION = "v1"
API_PREFIX = f"/api/{API_VERSION}"

MODEL_PRICING_CATALOG = [
    {"provider": "OPENAI", "modelId": "gpt-4o", "inputCostPerMillion": 2.50, "outputCostPerMillion": 10.00},
    {"provider": "OPENAI", "modelId": "gpt-4o-mini", "inputCostPerMillion": 0.15, "outputCostPerMillion": 0.60},
    {"provider": "ANTHROPIC", "modelId": "claude-3-5-sonnet-20241022", "inputCostPerMillion": 3.00, "outputCostPerMillion": 15.00},
    {"provider": "ANTHROPIC", "modelId": "claude-3-5-haiku-20241022", "inputCostPerMillion": 0.80, "outputCostPerMillion": 4.00},
    {"provider": "GOOGLE", "modelId": "gemini-2.0-flash-001", "inputCostPerMillion": 0.10, "outputCostPerMillion": 0.40},
    {"provider": "GOOGLE", "modelId": "gemini-1.5-flash", "inputCostPerMillion": 0.075, "outputCostPerMillion": 0.30},
    {"provider": "GOOGLE", "modelId": "gemini-1.5-pro", "inputCostPerMillion": 3.50, "outputCostPerMillion": 10.50},
    {"provider": "COHERE", "modelId": "command-r-plus", "inputCostPerMillion": 2.50, "outputCostPerMillion": 10.00},
    {"provider": "COHERE", "modelId": "command-r", "inputCostPerMillion": 0.15, "outputCostPerMillion": 0.60},
    {"provider": "MISTRAL", "modelId": "mistral-large-latest", "inputCostPerMillion": 2.00, "outputCostPerMillion": 6.00},
    {"provider": "MISTRAL", "modelId": "mistral-small-latest", "inputCostPerMillion": 0.20, "outputCostPerMillion": 0.60},
    {"provider": "OLLAMA", "modelId": "llama3.2:3b", "inputCostPerMillion": 0.001, "outputCostPerMillion": 0.001},
]

ERROR_CODES = {
    "UNAUTHORIZED": "UNAUTHORIZED",
    "FORBIDDEN": "FORBIDDEN",
    "TOKEN_EXPIRED": "TOKEN_EXPIRED",
    "INVALID_API_KEY": "INVALID_API_KEY",
    "RATE_LIMIT_EXCEEDED": "RATE_LIMIT_EXCEEDED",
    "TOKEN_LIMIT_EXCEEDED": "TOKEN_LIMIT_EXCEEDED",
    "BUDGET_EXCEEDED": "BUDGET_EXCEEDED",
    "BUDGET_NOT_FOUND": "BUDGET_NOT_FOUND",
    "PROVIDER_ERROR": "PROVIDER_ERROR",
    "PROVIDER_UNAVAILABLE": "PROVIDER_UNAVAILABLE",
    "ALL_PROVIDERS_FAILED": "ALL_PROVIDERS_FAILED",
    "VALIDATION_ERROR": "VALIDATION_ERROR",
    "INVALID_REQUEST": "INVALID_REQUEST",
    "NOT_FOUND": "NOT_FOUND",
    "CONFLICT": "CONFLICT",
    "INTERNAL_ERROR": "INTERNAL_ERROR",
}
