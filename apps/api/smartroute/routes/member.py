"""Member management routes — /api/v1/workspaces/current/members."""

from __future__ import annotations

import logging
import secrets
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, status
from fastapi.responses import Response
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from smartroute.config import settings
from smartroute.db import get_db
from smartroute.errors import AppError
from smartroute.lib.invites import delete_invite, get_invite, list_workspace_invites, store_invite
from smartroute.lib.member_lifecycle import assert_owner_can_leave
from smartroute.lib.plan_enforcement import enforce_member_limit
from smartroute.middleware.auth import (
    AuthPayload,
    can_admin,
    can_owner,
    get_auth_user_id,
    get_auth_workspace_id,
    load_workspace_role,
    require_auth,
    require_email_verified,
)
from smartroute.models import AuditAction, AuditLog, User, Workspace, WorkspaceMember, WorkspaceMemberRole
from smartroute.schemas.workspace import AcceptInviteRequest, InviteMemberRequest, PatchMemberRequest
from smartroute.services.auth_service import AuthService
from smartroute.services.email_service import email_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/workspaces", tags=["members"])


from smartroute.lib.responses import success_response


def _ok(data: object, status_code: int = status.HTTP_200_OK) -> Response:
    return success_response(data, status_code=status_code)


@router.get("/current/members", dependencies=[Depends(require_auth), Depends(load_workspace_role)])
async def list_members(
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    workspace_id = get_auth_workspace_id(user)
    result = await db.execute(
        select(WorkspaceMember)
        .options(selectinload(WorkspaceMember.user))
        .where(WorkspaceMember.workspace_id == workspace_id)
        .order_by(WorkspaceMember.joined_at.asc())
    )
    members = result.scalars().all()
    return _ok(
        [
            {
                "id": m.id,
                "role": m.role,
                "userId": m.user_id,
                "joinedAt": m.joined_at.isoformat() if m.joined_at else None,
                "user": {
                    "id": m.user.id,
                    "name": m.user.name,
                    "email": m.user.email,
                    "avatarUrl": m.user.avatar_url,
                    "lastLoginAt": m.user.last_login_at.isoformat() if m.user.last_login_at else None,
                },
            }
            for m in members
        ]
    )


@router.post(
    "/current/members/invite",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_auth), Depends(load_workspace_role), Depends(can_admin), Depends(require_email_verified)],
)
async def invite_member(
    body: InviteMemberRequest,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    workspace_id = get_auth_workspace_id(user)
    user_id = get_auth_user_id(user)

    await enforce_member_limit(db, workspace_id)

    existing = await db.execute(
        select(User)
        .options(selectinload(User.workspace_memberships))
        .where(User.email == body.email)
    )
    existing_user = existing.scalar_one_or_none()
    if existing_user and any(m.workspace_id == workspace_id for m in existing_user.workspace_memberships):
        raise AppError.conflict("User is already a workspace member")

    workspace = await db.get(Workspace, workspace_id)
    inviter = await db.get(User, user_id)
    if not workspace or not inviter:
        raise AppError.not_found("Workspace or inviter not found")

    token = secrets.token_hex(32)
    invited_at = datetime.now(timezone.utc).isoformat()

    await store_invite(
        workspace_id,
        token,
        {"email": body.email, "role": body.role, "invitedBy": user_id, "invitedAt": invited_at},
    )

    accept_url = f"{settings.web_base_url}/accept-invite?token={token}"
    sent = await email_service.send_member_invite(
        body.email,
        {
            "workspaceName": workspace.name,
            "inviterName": inviter.name,
            "role": body.role,
            "acceptUrl": accept_url,
        },
    )
    if not sent and settings.NODE_ENV != "production":
        logger.info("Invite email skipped — accept URL (dev only): %s", accept_url)

    db.add(
        AuditLog(
            workspace_id=workspace_id,
            user_id=user_id,
            action=AuditAction.MEMBER_ADDED.value,
            resource_type="invite",
            metadata_={"email": body.email, "role": body.role, "pending": True},
        )
    )
    await db.flush()

    return _ok(
        {
            "email": body.email,
            "role": body.role,
            "acceptUrl": accept_url,
            "expiresInDays": 7,
            "token": token,
        },
        status.HTTP_201_CREATED,
    )


@router.get(
    "/current/members/invites",
    dependencies=[Depends(require_auth), Depends(load_workspace_role), Depends(can_admin)],
)
async def list_invites(user: Annotated[AuthPayload, Depends(require_auth)]):
    workspace_id = get_auth_workspace_id(user)
    invites = await list_workspace_invites(workspace_id)
    return _ok(invites)


@router.delete(
    "/current/members/invites/{token}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_auth), Depends(load_workspace_role), Depends(can_admin)],
)
async def revoke_invite(
    token: str,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    workspace_id = get_auth_workspace_id(user)
    invite = await get_invite(token)
    if not invite:
        raise AppError.not_found("Invite not found or expired")
    if invite["workspaceId"] != workspace_id:
        raise AppError.forbidden("Invite belongs to another workspace")

    await delete_invite(workspace_id, token)
    db.add(
        AuditLog(
            workspace_id=workspace_id,
            user_id=get_auth_user_id(user),
            action=AuditAction.MEMBER_REMOVED.value,
            resource_type="invite",
            metadata_={"email": invite["email"], "revoked": True},
        )
    )
    await db.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/current/members/accept-invite", dependencies=[Depends(require_auth)])
async def accept_invite(
    body: AcceptInviteRequest,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    user_id = get_auth_user_id(user)
    invite = await get_invite(body.token)
    if not invite:
        raise AppError.not_found("Invite not found or expired")

    db_user = await db.get(User, user_id)
    if not db_user:
        raise AppError.not_found("User not found")
    if db_user.email != invite["email"]:
        raise AppError.forbidden("Invite email does not match your account")

    await enforce_member_limit(db, invite["workspaceId"])

    member = WorkspaceMember(
        workspace_id=invite["workspaceId"],
        user_id=user_id,
        role=invite["role"],
        invited_by=invite["invitedBy"],
    )
    db.add(member)
    await db.flush()

    member_result = await db.execute(
        select(WorkspaceMember)
        .options(selectinload(WorkspaceMember.user))
        .where(WorkspaceMember.id == member.id)
    )
    member = member_result.scalar_one()

    await delete_invite(invite["workspaceId"], body.token)

    db.add(
        AuditLog(
            workspace_id=invite["workspaceId"],
            user_id=user_id,
            action=AuditAction.MEMBER_ADDED.value,
            resource_type="member",
            resource_id=member.id,
            metadata_={"via": "invite"},
        )
    )

    switched = await AuthService(db).switch_workspace(user_id, invite["workspaceId"])

    return _ok(
        {
            "member": {
                "id": member.id,
                "role": member.role,
                "user": {
                    "id": db_user.id,
                    "name": db_user.name,
                    "email": db_user.email,
                },
            },
            "workspaceId": invite["workspaceId"],
            "user": switched["user"].model_dump(by_alias=True, mode="json"),
            "tokens": switched["tokens"].model_dump(by_alias=True, mode="json"),
        }
    )


@router.patch(
    "/current/members/{target_user_id}",
    dependencies=[Depends(require_auth), Depends(load_workspace_role), Depends(can_admin)],
)
async def patch_member(
    target_user_id: str,
    body: PatchMemberRequest,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    workspace_id = get_auth_workspace_id(user)
    result = await db.execute(
        select(WorkspaceMember)
        .options(selectinload(WorkspaceMember.user))
        .where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == target_user_id)
    )
    member = result.scalar_one_or_none()
    if not member:
        raise AppError.not_found("Member not found")
    if member.role == WorkspaceMemberRole.OWNER.value:
        raise AppError.forbidden("Cannot change the owner role here — use transfer ownership")

    previous_role = member.role
    member.role = body.role
    await db.flush()

    db.add(
        AuditLog(
            workspace_id=workspace_id,
            user_id=get_auth_user_id(user),
            action=AuditAction.MEMBER_ROLE_CHANGED.value,
            resource_type="member",
            resource_id=member.id,
            metadata_={"newRole": body.role, "previousRole": previous_role},
        )
    )
    await db.flush()

    return _ok(
        {
            "id": member.id,
            "role": member.role,
            "userId": member.user_id,
            "user": {
                "id": member.user.id,
                "name": member.user.name,
                "email": member.user.email,
            },
        }
    )


@router.post(
    "/current/members/{target_user_id}/transfer-ownership",
    dependencies=[Depends(require_auth), Depends(load_workspace_role), Depends(can_owner)],
)
async def transfer_ownership(
    target_user_id: str,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    workspace_id = get_auth_workspace_id(user)
    actor_id = get_auth_user_id(user)

    if target_user_id == actor_id:
        raise AppError.bad_request("Cannot transfer ownership to yourself")

    owner_result = await db.execute(
        select(WorkspaceMember)
        .options(selectinload(WorkspaceMember.user))
        .where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == actor_id)
    )
    owner_membership = owner_result.scalar_one_or_none()

    target_result = await db.execute(
        select(WorkspaceMember)
        .options(selectinload(WorkspaceMember.user))
        .where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == target_user_id)
    )
    target_membership = target_result.scalar_one_or_none()

    if not owner_membership or owner_membership.role != WorkspaceMemberRole.OWNER.value:
        raise AppError.forbidden("Only the workspace owner can transfer ownership")
    if not target_membership:
        raise AppError.not_found("Member not found")

    owner_membership.role = WorkspaceMemberRole.ADMIN.value
    target_membership.role = WorkspaceMemberRole.OWNER.value
    await db.flush()

    db.add(
        AuditLog(
            workspace_id=workspace_id,
            user_id=actor_id,
            action=AuditAction.MEMBER_ROLE_CHANGED.value,
            resource_type="member",
            resource_id=target_membership.id,
            metadata_={
                "transfer": True,
                "newOwnerId": target_user_id,
                "previousOwnerId": actor_id,
            },
        )
    )
    await db.flush()

    return _ok(
        {
            "previousOwner": {
                "id": owner_membership.id,
                "role": owner_membership.role,
                "user": {
                    "id": owner_membership.user.id,
                    "name": owner_membership.user.name,
                    "email": owner_membership.user.email,
                },
            },
            "newOwner": {
                "id": target_membership.id,
                "role": target_membership.role,
                "user": {
                    "id": target_membership.user.id,
                    "name": target_membership.user.name,
                    "email": target_membership.user.email,
                },
            },
        }
    )


@router.post("/current/members/leave", dependencies=[Depends(require_auth), Depends(load_workspace_role)])
async def leave_workspace(
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    workspace_id = get_auth_workspace_id(user)
    user_id = get_auth_user_id(user)

    result = await db.execute(
        select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user_id)
    )
    membership = result.scalar_one_or_none()
    if not membership:
        raise AppError.not_found("You are not a member of this workspace")

    workspace = await db.get(Workspace, workspace_id)
    if not workspace:
        raise AppError.not_found("Workspace not found")

    workspace_deactivated = False
    if membership.role == WorkspaceMemberRole.OWNER.value:
        other_count = await db.scalar(
            select(func.count())
            .select_from(WorkspaceMember)
            .where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id != user_id)
        )
        assert_owner_can_leave(other_count or 0, workspace.name)
        workspace.deleted_at = datetime.now(timezone.utc)
        workspace.is_active = False
        await db.execute(delete(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace_id))
        workspace_deactivated = True
    else:
        await db.delete(membership)
        db.add(
            AuditLog(
                workspace_id=workspace_id,
                user_id=user_id,
                action=AuditAction.MEMBER_REMOVED.value,
                resource_type="member",
                resource_id=membership.id,
                metadata_={"self": True},
            )
        )

    await db.flush()

    next_membership = await db.execute(
        select(WorkspaceMember.workspace_id)
        .where(WorkspaceMember.user_id == user_id)
        .order_by(WorkspaceMember.joined_at.asc())
        .limit(1)
    )
    next_workspace_id = next_membership.scalar_one_or_none()

    if next_workspace_id:
        switched = await AuthService(db).switch_workspace(user_id, next_workspace_id)
        return _ok(
            {
                "left": True,
                "workspaceDeactivated": workspace_deactivated,
                "user": switched["user"].model_dump(by_alias=True, mode="json"),
                "tokens": switched["tokens"].model_dump(by_alias=True, mode="json"),
            }
        )

    return _ok(
        {
            "left": True,
            "workspaceDeactivated": workspace_deactivated,
            "noWorkspacesRemaining": True,
        }
    )


@router.delete(
    "/current/members/{target_user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_auth), Depends(load_workspace_role), Depends(can_admin)],
)
async def remove_member(
    target_user_id: str,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    workspace_id = get_auth_workspace_id(user)
    actor_id = get_auth_user_id(user)

    if target_user_id == actor_id:
        raise AppError.bad_request("Cannot remove yourself")

    result = await db.execute(
        select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == target_user_id)
    )
    member = result.scalar_one_or_none()
    if not member:
        raise AppError.not_found("Member not found")
    if member.role == WorkspaceMemberRole.OWNER.value:
        raise AppError.forbidden("Cannot remove workspace owner")

    member_id = member.id
    await db.delete(member)
    db.add(
        AuditLog(
            workspace_id=workspace_id,
            user_id=actor_id,
            action=AuditAction.MEMBER_REMOVED.value,
            resource_type="member",
            resource_id=member_id,
        )
    )
    await db.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
