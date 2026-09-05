"""Chat gateway routes."""

from __future__ import annotations

import json
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse

from smartroute.errors import AppError
from smartroute.middleware.gateway import (
    apply_output_redaction,
    attach_rate_limit_headers,
    check_idempotency,
    check_prompt_guard,
)
from smartroute.routes.deps import get_repository, require_scope
from smartroute.services.gateway_service import GatewayOptions, StreamHandlers, gateway_service
from smartroute.shared.schemas import ChatRequest
from smartroute.types.gateway import GatewayRequestState

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("")
async def chat_completion(
    request: Request,
    body: ChatRequest,
    state: Annotated[GatewayRequestState, Depends(require_scope("chat:write"))],
    repo=Depends(get_repository),
):
    guard_response = await check_prompt_guard(body.model_dump(by_alias=True), state.api_key.workspace_id, state.request_id)
    if guard_response:
        return guard_response

    idempotent = await check_idempotency(request, state.api_key.workspace_id, state.request_id)
    if idempotent:
        return idempotent

    rate_limit_holder: dict[str, Any] = {}

    def on_rate_limit(info) -> None:
        rate_limit_holder["info"] = info

    try:
        response_data = await gateway_service.process_chat(
            body,
            GatewayOptions(
                request_id=state.request_id,
                trace_id=state.trace_id,
                api_key=state.api_key,
                on_rate_limit=on_rate_limit,
            ),
            repo,
        )
    except AppError as err:
        content = {
            "success": False,
            "error": {
                "code": err.code,
                "message": err.message,
                "details": err.details,
                "requestId": state.request_id,
            },
        }
        response = JSONResponse(status_code=err.status_code, content=content)
        if err.status_code == 429 and err.details and isinstance(err.details, dict):
            retry_after = err.details.get("retryAfter")
            if retry_after is not None:
                response.headers["Retry-After"] = str(retry_after)
        return response

    payload = apply_output_redaction({"success": True, "data": response_data})
    response = JSONResponse(status_code=200, content=payload)
    response.headers["X-Request-ID"] = state.request_id
    response.headers["X-Trace-ID"] = state.trace_id
    attach_rate_limit_headers(response, rate_limit_holder.get("info"))

    redis_key = getattr(request.state, "idempotency_redis_key", None)
    if redis_key:
        import json

        from smartroute.redis_client import get_redis

        try:
            await get_redis().set(
                redis_key,
                json.dumps({"status": 200, "body": payload, "requestId": state.request_id}),
                ex=86400,
            )
        except Exception:
            pass

    return response


@router.post("/stream")
async def chat_stream(
    request: Request,
    body: ChatRequest,
    state: Annotated[GatewayRequestState, Depends(require_scope("chat:write"))],
    repo=Depends(get_repository),
):
    guard_response = await check_prompt_guard(body.model_dump(by_alias=True), state.api_key.workspace_id, state.request_id)
    if guard_response:
        return guard_response

    idempotent = await check_idempotency(request, state.api_key.workspace_id, state.request_id)
    if idempotent:
        return idempotent

    async def event_generator():
        import asyncio

        queue: asyncio.Queue[str | None] = asyncio.Queue()

        def send(data: dict[str, Any]) -> str:
            return f"data: {json.dumps(data)}\n\n"

        async def emit_routing(data: dict[str, Any]) -> None:
            await queue.put(send({"type": "routing", **data}))

        async def emit_delta(content: str) -> None:
            await queue.put(send({"type": "delta", "content": content}))

        async def run_gateway() -> None:
            try:
                done = await gateway_service.process_chat_stream(
                    body,
                    GatewayOptions(
                        request_id=state.request_id,
                        trace_id=state.trace_id,
                        api_key=state.api_key,
                        on_rate_limit=lambda _info: None,
                    ),
                    StreamHandlers(on_routing=emit_routing, on_delta=emit_delta),
                    repo,
                )
                await queue.put(
                    send(
                        {
                            "type": "done",
                            "requestId": done.request_id,
                            "traceId": done.trace_id,
                            "finishReason": done.finish_reason,
                            "usage": done.usage,
                            "cost": done.cost,
                            "routing": done.routing,
                        }
                    )
                )
            except AppError as err:
                await queue.put(send({"type": "error", "code": err.code, "message": err.message}))
            except Exception as err:
                await queue.put(send({"type": "error", "code": "STREAM_ERROR", "message": str(err)}))
            finally:
                await queue.put(None)

        task = asyncio.create_task(run_gateway())
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield item
        finally:
            await task

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "X-Request-ID": state.request_id,
            "X-Trace-ID": state.trace_id,
        },
    )

