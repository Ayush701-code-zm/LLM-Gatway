"""Workspace invite storage in Redis."""

from __future__ import annotations

import json
from typing import Literal, TypedDict

from smartroute.redis_client import get_redis

INVITE_TTL_SEC = 7 * 24 * 60 * 60

WorkspaceInviteRole = Literal["ADMIN", "MEMBER", "VIEWER"]


class PendingInvite(TypedDict):
    token: str
    workspaceId: str
    email: str
    role: WorkspaceInviteRole
    invitedBy: str
    invitedAt: str
    expiresAt: str


def _workspace_index_key(workspace_id: str) -> str:
    return f"workspace:invites:{workspace_id}"


def _invite_key(token: str) -> str:
    return f"invite:{token}"


async def store_invite(
    workspace_id: str,
    token: str,
    data: dict,
) -> None:
    redis = get_redis()
    from datetime import datetime, timedelta, timezone

    expires_at = (datetime.now(timezone.utc) + timedelta(seconds=INVITE_TTL_SEC)).isoformat()
    payload: PendingInvite = {
        "token": token,
        "workspaceId": workspace_id,
        "email": data["email"],
        "role": data["role"],
        "invitedBy": data["invitedBy"],
        "invitedAt": data["invitedAt"],
        "expiresAt": expires_at,
    }

    async with redis.pipeline(transaction=True) as pipe:
        pipe.set(_invite_key(token), json.dumps(payload), ex=INVITE_TTL_SEC)
        pipe.sadd(_workspace_index_key(workspace_id), token)
        await pipe.execute()


async def get_invite(token: str) -> PendingInvite | None:
    redis = get_redis()
    raw = await redis.get(_invite_key(token))
    if not raw:
        return None
    return json.loads(raw)


async def delete_invite(workspace_id: str, token: str) -> None:
    redis = get_redis()
    async with redis.pipeline(transaction=True) as pipe:
        pipe.delete(_invite_key(token))
        pipe.srem(_workspace_index_key(workspace_id), token)
        await pipe.execute()


async def list_workspace_invites(workspace_id: str) -> list[PendingInvite]:
    redis = get_redis()
    tokens = await redis.smembers(_workspace_index_key(workspace_id))
    if not tokens:
        return []

    invites: list[PendingInvite] = []
    for token in tokens:
        token_str = token.decode() if isinstance(token, bytes) else token
        invite = await get_invite(token_str)
        if invite:
            invites.append(invite)
        else:
            await redis.srem(_workspace_index_key(workspace_id), token_str)

    return sorted(invites, key=lambda i: i["invitedAt"], reverse=True)
