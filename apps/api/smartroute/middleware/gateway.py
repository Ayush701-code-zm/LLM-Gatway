"""Gateway middleware: prompt guard, idempotency, backpressure, output redaction."""

from __future__ import annotations

import json
import re
from collections.abc import Awaitable, Callable
from typing import Any

import hashlib
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, Header, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.middleware.base import BaseHTTPMiddleware

from smartroute.config import settings
from smartroute.config.logger import logger
from smartroute.config.metrics import injection_attempts_total
from smartroute.db import get_db
from smartroute.errors import AppError
from smartroute.lib.constants import ERROR_CODES
from smartroute.middleware.auth import get_client_ip
from smartroute.models import ApiKey, ApiKeyStatus
from smartroute.redis_client import get_redis
from smartroute.types.gateway import ApiKeyContext

BLOCK_THRESHOLD = 0.70
WARN_THRESHOLD = 0.40
IDEMPOTENCY_PREFIX = "idem:"
IDEMPOTENCY_TTL_SECONDS = 86_400
MAX_KEY_LENGTH = 255
INFLIGHT_KEY = "gateway:inflight"


def _redis_str(value: bytes | str | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, bytes):
        return value.decode()
    return value


class SignalPattern:
    __slots__ = ("label", "weight", "pattern")

    def __init__(self, label: str, weight: float, pattern: str) -> None:
        self.label = label
        self.weight = weight
        self.pattern = re.compile(pattern, re.IGNORECASE)


SIGNALS = [
    SignalPattern("role_override", 0.45, r"\b(you are now|act as|pretend (to be|you are)|roleplay as|your new (role|persona|identity) is)\b"),
    SignalPattern("dan_jailbreak", 0.80, r"\bDAN\b|\bdo anything now\b|\bjailbreak\b"),
    SignalPattern("developer_mode", 0.60, r"\b(developer mode|sudo mode|god mode|unrestricted mode|bypass (all )?(restrictions|filters|safety))\b"),
    SignalPattern("ignore_previous", 0.55, r"\b(ignore|disregard|forget|override)\b.{0,40}\b(previous|above|prior|all)\b.{0,40}\b(instruction|prompt|rule|guideline|context|message)\b"),
    SignalPattern("system_override", 0.65, r"\[SYSTEM\]|\[INST\]|\[\/INST\]|<\|system\|>|<\|user\|>|<\|assistant\|>"),
    SignalPattern("new_instructions", 0.45, r"\b(your (new |real |actual |true |only )?(instruction|task|job|goal|purpose|directive|objective) (is|are|will be))\b"),
    SignalPattern("delimiter_attack", 0.50, r"(-{4,}|={4,}|\*{4,}|_{4,})\s*(system|user|assistant|instruction|prompt|context)"),
    SignalPattern("template_injection", 0.40, r"\{\{.*?\}\}|\{%.*?%\}|<%.*?%>"),
    SignalPattern("xml_injection", 0.35, r"<(system|prompt|instruction|context|task|role)>"),
    SignalPattern("exfil_prompt", 0.55, r"\b(repeat|print|output|reveal|show|tell me|display|write out).{0,50}\b(system prompt|instruction|context|training data|secret|password|api key)\b"),
    SignalPattern("exfil_base64", 0.40, r"\b(encode|decode|base64).{0,30}\b(system|instruction|prompt)\b"),
    SignalPattern("safety_bypass", 0.50, r"\b(without|no|disable|remove|bypass|ignore)\b.{0,30}\b(ethical|moral|safety|content|filter|restriction|guideline|policy|limit)\b"),
    SignalPattern("hypothetical_bypass", 0.35, r"\b(hypothetically|theoretically|in a fictional|imagine if|what if .{0,30} no (rule|law|restriction|limit|filter))\b"),
    SignalPattern("token_manipulation", 0.30, r"(\w)\1{15,}"),
    SignalPattern("prompt_length_bomb", 0.25, r"(.)\1{8,}"),
]

REDACTION_PATTERNS = [
    ("openai_key", re.compile(r"\bsk-[a-zA-Z0-9]{20,}\b"), "[REDACTED_OPENAI_KEY]"),
    ("anthropic_key", re.compile(r"\bsk-ant-[a-zA-Z0-9_-]{20,}\b"), "[REDACTED_ANTHROPIC_KEY]"),
    ("bearer_token", re.compile(r"\bBearer\s+[a-zA-Z0-9._-]{20,}\b", re.IGNORECASE), "Bearer [REDACTED]"),
    ("aws_key", re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "[REDACTED_AWS_KEY]"),
    ("jwt", re.compile(r"\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b"), "[REDACTED_JWT]"),
    ("email", re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"), "[REDACTED_EMAIL]"),
    ("credit_card", re.compile(r"\b(?:\d[ -]*?){13,16}\b"), "[REDACTED_CARD]"),
]


def _normalise(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\x20-\x7E\n]", " ", text.replace("\u200b", ""))).strip().lower()


def scan_text(text: str) -> tuple[float, list[str]]:
    normalised = _normalise(text)
    matched: list[str] = []
    score = 0.0
    for signal in SIGNALS:
        if signal.pattern.search(normalised):
            matched.append(signal.label)
            score += signal.weight
    return min(score, 1.0), matched


def redact_output(text: str) -> tuple[str, list[str]]:
    result = text
    redacted: list[str] = []
    for label, pattern, replacement in REDACTION_PATTERNS:
        if pattern.search(result):
            redacted.append(label)
            result = pattern.sub(replacement, result)
    return result, redacted


async def check_prompt_guard(body: dict[str, Any], workspace_id: str, request_id: str) -> JSONResponse | None:
    try:
        message = str(body.get("message") or "")
        system_prompt = str(body.get("systemPrompt") or body.get("system_prompt") or "")
        if not message and not system_prompt:
            return None

        msg_score, msg_matched = scan_text(message)
        sys_score, sys_matched = scan_text(system_prompt)
        worst_score = max(msg_score, sys_score)
        all_matched = list(dict.fromkeys([*msg_matched, *sys_matched]))

        if worst_score >= BLOCK_THRESHOLD:
            injection_attempts_total.labels(severity="blocked", workspace_id=workspace_id).inc()
            logger.warn(
                "prompt_injection_blocked",
                workspace_id=workspace_id,
                score=f"{worst_score:.3f}",
                signals=all_matched,
                request_id=request_id,
            )
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "error": {
                        "code": "PROMPT_INJECTION_DETECTED",
                        "message": "The request was blocked because it appears to contain prompt injection patterns.",
                        "requestId": request_id,
                    },
                },
            )

        if worst_score >= WARN_THRESHOLD:
            injection_attempts_total.labels(severity="flagged", workspace_id=workspace_id).inc()
            logger.warn(
                "prompt_injection_flagged",
                workspace_id=workspace_id,
                score=f"{worst_score:.3f}",
                signals=all_matched,
                request_id=request_id,
            )
        return None
    except Exception as exc:
        logger.error("prompt_guard_failed_open", err=str(exc))
        return None


async def check_idempotency(
    request: Request,
    workspace_id: str,
    request_id: str,
) -> JSONResponse | None:
    raw_key = request.headers.get("idempotency-key") or request.headers.get("Idempotency-Key")
    if not raw_key:
        return None
    if len(raw_key) > MAX_KEY_LENGTH:
        return JSONResponse(
            status_code=400,
            content={
                "success": False,
                "error": {
                    "code": "INVALID_IDEMPOTENCY_KEY",
                    "message": f"Idempotency-Key must be ≤ {MAX_KEY_LENGTH} characters",
                },
            },
        )

    redis_key = f"{IDEMPOTENCY_PREFIX}{workspace_id}:{raw_key}"
    try:
        redis = get_redis()
        cached = await redis.get(redis_key)
        if cached:
            parsed = json.loads(_redis_str(cached) or "{}")
            response = JSONResponse(status_code=parsed["status"], content=parsed["body"])
            response.headers["X-Idempotent-Replayed"] = "true"
            response.headers["X-Request-ID"] = parsed["requestId"]
            return response
        request.state.idempotency_key = raw_key
        request.state.idempotency_redis_key = redis_key
    except Exception as exc:
        logger.warn("idempotency_read_failed_open", err=str(exc))
    return None


async def cache_idempotent_response(request: Request, response: Response) -> None:
    redis_key = getattr(request.state, "idempotency_redis_key", None)
    if not redis_key or response.status_code < 200 or response.status_code >= 300:
        return
    try:
        body = json.loads(response.body.decode())
        payload = json.dumps(
            {
                "status": response.status_code,
                "body": body,
                "requestId": getattr(request.state, "request_id", ""),
            }
        )
        redis = get_redis()
        await redis.set(redis_key, payload, ex=IDEMPOTENCY_TTL_SECONDS)
    except Exception:
        pass


async def acquire_backpressure() -> None:
    redis = get_redis()
    current = await redis.incr(INFLIGHT_KEY)
    if current == 1:
        await redis.expire(INFLIGHT_KEY, 300)
    if current > settings.MAX_INFLIGHT_REQUESTS:
        await redis.decr(INFLIGHT_KEY)
        raise AppError(503, "BACKPRESSURE", "Gateway is at capacity. Retry shortly.")


async def release_backpressure() -> None:
    try:
        redis = get_redis()
        await redis.decr(INFLIGHT_KEY)
    except Exception:
        pass


def apply_output_redaction(payload: dict[str, Any]) -> dict[str, Any]:
    data = payload.get("data")
    if not isinstance(data, dict):
        return payload
    message = data.get("message")
    if not isinstance(message, str):
        return payload
    redacted_text, labels = redact_output(message)
    if labels:
        data["message"] = redacted_text
        data["redactionApplied"] = True
        data["redactionLabels"] = labels
    return payload


def attach_rate_limit_headers(response: Response, rate_limit_info) -> None:
    if not rate_limit_info:
        return
    response.headers["X-RateLimit-Limit-RPM"] = str(rate_limit_info.limit_rpm)
    response.headers["X-RateLimit-Remaining-RPM"] = str(rate_limit_info.remaining_rpm)
    response.headers["X-RateLimit-Reset-RPM"] = str(rate_limit_info.reset_rpm)
    response.headers["X-RateLimit-Limit-RPD"] = str(rate_limit_info.limit_rpd)
    response.headers["X-RateLimit-Remaining-RPD"] = str(rate_limit_info.remaining_rpd)
    response.headers["X-RateLimit-Reset-RPD"] = str(rate_limit_info.reset_rpd)


class BackpressureMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        if not request.url.path.startswith("/api/v1/chat"):
            return await call_next(request)
        try:
            await acquire_backpressure()
        except AppError as err:
            return JSONResponse(
                status_code=err.status_code,
                content={"success": False, "error": {"code": err.code, "message": err.message}},
                headers={"Retry-After": "5"},
            )
        except Exception as exc:
            logger.error("backpressure_failed_open", err=str(exc))
            return await call_next(request)

        try:
            return await call_next(request)
        finally:
            await release_backpressure()


async def require_api_key(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    x_api_key: Annotated[str | None, Header(alias="X-API-Key")] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> ApiKeyContext:
    raw_key = x_api_key
    if not raw_key and authorization and authorization.startswith("Bearer sk-"):
        raw_key = authorization[7:]

    if not raw_key:
        raise AppError.unauthorized("API key required. Provide X-API-Key header.")

    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    result = await db.execute(select(ApiKey).where(ApiKey.key_hash == key_hash))
    api_key = result.scalar_one_or_none()

    if not api_key or api_key.status != ApiKeyStatus.ACTIVE.value:
        raise AppError(401, ERROR_CODES["INVALID_API_KEY"], "Invalid or revoked API key")

    if api_key.expires_at and api_key.expires_at.replace(tzinfo=UTC) < datetime.now(UTC):
        raise AppError(401, ERROR_CODES["INVALID_API_KEY"], "API key has expired")

    api_key.last_used_at = datetime.now(UTC)
    api_key.last_used_ip = get_client_ip(request)
    api_key.request_count = int(api_key.request_count or 0) + 1
    await db.flush()

    context = ApiKeyContext(id=api_key.id, workspace_id=api_key.workspace_id, scopes=list(api_key.scopes or []))
    request.state.api_key = context
    return context
