"""JSON-safe API response helpers."""

from __future__ import annotations

from dataclasses import asdict, is_dataclass
from datetime import date, datetime
from enum import Enum
from uuid import UUID

import orjson
from starlette.responses import Response


def jsonable(obj: object) -> object:
    if obj is None:
        return None
    if is_dataclass(obj):
        return asdict(obj)
    if hasattr(obj, "model_dump"):
        return obj.model_dump(by_alias=True, mode="json")
    if isinstance(obj, dict):
        return {k: jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [jsonable(item) for item in obj]
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, date):
        return obj.isoformat()
    if isinstance(obj, Enum):
        return obj.value
    if isinstance(obj, UUID):
        return str(obj)
    return obj


def success_response(data: object, status_code: int = 200, **extra: object) -> Response:
    body: dict = {"success": True, "data": jsonable(data)}
    for key, value in extra.items():
        body[key] = jsonable(value)
    return Response(content=orjson.dumps(body), status_code=status_code, media_type="application/json")
