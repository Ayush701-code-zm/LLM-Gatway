"""Shared constants ported from @smartroute/shared."""

from __future__ import annotations

PLAN_LIMITS = {
    "FREE": {
        "requestsPerMinute": 10,
        "requestsPerHour": 100,
        "requestsPerDay": 500,
        "tokensPerMinute": 50_000,
        "tokensPerDay": 1_000_000,
        "maxWorkspaceMembers": 1,
        "maxApiKeys": 2,
        "budgetLimitUsd": 10,
    },
    "PRO": {
        "requestsPerMinute": 60,
        "requestsPerHour": 1_000,
        "requestsPerDay": 10_000,
        "tokensPerMinute": 500_000,
        "tokensPerDay": 10_000_000,
        "maxWorkspaceMembers": 10,
        "maxApiKeys": 20,
        "budgetLimitUsd": 500,
    },
    "ENTERPRISE": {
        "requestsPerMinute": 1_000,
        "requestsPerHour": 50_000,
        "requestsPerDay": 500_000,
        "tokensPerMinute": 5_000_000,
        "tokensPerDay": 100_000_000,
        "maxWorkspaceMembers": -1,
        "maxApiKeys": -1,
        "budgetLimitUsd": -1,
    },
}

BUDGET_THRESHOLDS = {
    "WARNING": 0.8,
    "CRITICAL": 0.9,
    "BLOCKED": 1.0,
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
}

COMPLEXITY_THRESHOLDS = {
    "SIMPLE_MAX_SCORE": 0.12,
    "MEDIUM_MAX_SCORE": 0.40,
}

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

RESERVED_WORKSPACE_SLUGS = {
    "admin",
    "api",
    "app",
    "assets",
    "auth",
    "dashboard",
    "docs",
    "health",
    "login",
    "oauth",
    "register",
    "saml",
    "scim",
    "settings",
    "static",
    "support",
    "www",
}


def is_reserved_workspace_slug(slug: str) -> bool:
    return slug.lower() in RESERVED_WORKSPACE_SLUGS
