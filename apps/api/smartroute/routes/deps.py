"""FastAPI dependencies for gateway routes."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import Depends, Header, Request

from smartroute.db import get_db
from smartroute.db.repository import GatewayRepository
from smartroute.lib.utils import generate_request_id
from smartroute.middleware.gateway import require_api_key
from smartroute.types.gateway import ApiKeyContext, GatewayRequestState
from sqlalchemy.ext.asyncio import AsyncSession


async def get_repository(
    session: Annotated[AsyncSession, Depends(get_db)],
) -> GatewayRepository:
    return GatewayRepository(session)


async def get_gateway_state(
    request: Request,
    api_key: Annotated[ApiKeyContext, Depends(require_api_key)],
    x_request_id: Annotated[str | None, Header(alias="X-Request-ID")] = None,
    x_trace_id: Annotated[str | None, Header(alias="X-Trace-ID")] = None,
) -> GatewayRequestState:
    if hasattr(request.state, "gateway_state"):
        return request.state.gateway_state

    state = GatewayRequestState(
        request_id=x_request_id or generate_request_id(),
        trace_id=x_trace_id or str(uuid.uuid4()),
        api_key=api_key,
    )
    request.state.gateway_state = state
    request.state.request_id = state.request_id
    request.state.api_key = api_key
    return state


def require_scope(scope: str):
    async def _dependency(
        state: Annotated[GatewayRequestState, Depends(get_gateway_state)],
    ) -> GatewayRequestState:
        if scope not in state.api_key.scopes:
            from smartroute.errors import AppError

            raise AppError.forbidden(f"Missing required scope: {scope}")
        return state

    return _dependency


def require_any_scope(*scopes: str):
    async def _dependency(
        state: Annotated[GatewayRequestState, Depends(get_gateway_state)],
    ) -> GatewayRequestState:
        if not any(s in state.api_key.scopes for s in scopes):
            from smartroute.errors import AppError

            raise AppError.forbidden("Missing required scope")
        return state

    return _dependency
