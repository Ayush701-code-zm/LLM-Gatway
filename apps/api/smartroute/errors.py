"""Application errors and FastAPI exception handlers."""

from __future__ import annotations

from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from smartroute.lib.constants import ERROR_CODES


class AppError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: Any | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details

    @classmethod
    def bad_request(cls, message: str, details: Any | None = None) -> AppError:
        return cls(400, ERROR_CODES["INVALID_REQUEST"], message, details)

    @classmethod
    def unauthorized(cls, message: str = "Unauthorized") -> AppError:
        return cls(401, ERROR_CODES["UNAUTHORIZED"], message)

    @classmethod
    def forbidden(cls, message: str = "Forbidden") -> AppError:
        return cls(403, ERROR_CODES["FORBIDDEN"], message)

    @classmethod
    def not_found(cls, message: str = "Resource not found") -> AppError:
        return cls(404, ERROR_CODES["NOT_FOUND"], message)

    @classmethod
    def conflict(cls, message: str) -> AppError:
        return cls(409, ERROR_CODES["CONFLICT"], message)

    @classmethod
    def rate_limit_exceeded(cls, retry_after_seconds: int) -> AppError:
        return cls(
            429,
            ERROR_CODES["RATE_LIMIT_EXCEEDED"],
            "Rate limit exceeded",
            {"retryAfter": retry_after_seconds},
        )

    @classmethod
    def budget_exceeded(cls, message: str = "Monthly budget exceeded") -> AppError:
        return cls(402, ERROR_CODES["BUDGET_EXCEEDED"], message)

    @classmethod
    def provider_error(cls, message: str, details: Any | None = None) -> AppError:
        return cls(502, ERROR_CODES["PROVIDER_ERROR"], message, details)

    @classmethod
    def internal(cls, message: str = "Internal server error") -> AppError:
        return cls(500, ERROR_CODES["INTERNAL_ERROR"], message)


def _error_body(code: str, message: str, details: Any | None = None, request_id: str | None = None) -> dict:
    return {
        "success": False,
        "error": {
            "code": code,
            "message": message,
            "details": details,
            "requestId": request_id,
        },
    }


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    headers: dict[str, str] = {}
    if exc.status_code == 429 and isinstance(exc.details, dict):
        retry_after = exc.details.get("retryAfter")
        if retry_after:
            headers["Retry-After"] = str(retry_after)

    request_id = getattr(request.state, "request_id", None)
    return JSONResponse(
        status_code=exc.status_code,
        content=_error_body(exc.code, exc.message, exc.details, request_id),
        headers=headers,
    )


async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None)
    field_errors: dict[str, list[str]] = {}
    for err in exc.errors():
        loc = ".".join(str(part) for part in err.get("loc", []) if part != "body")
        field_errors.setdefault(loc or "body", []).append(err.get("msg", "Invalid value"))

    return JSONResponse(
        status_code=400,
        content=_error_body(
            ERROR_CODES["VALIDATION_ERROR"],
            "Validation failed",
            field_errors,
            request_id,
        ),
    )


async def pydantic_validation_handler(request: Request, exc: ValidationError) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None)
    return JSONResponse(
        status_code=400,
        content=_error_body(
            ERROR_CODES["VALIDATION_ERROR"],
            "Validation failed",
            exc.errors(),
            request_id,
        ),
    )
