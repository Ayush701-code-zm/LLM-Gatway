"""Authentication, sessions, and user lifecycle."""

from __future__ import annotations

import hashlib
import logging
import random
import re
import secrets
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import bcrypt
from jose import jwt
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from smartroute.config import settings
from smartroute.errors import AppError
from smartroute.lib.sync_rate_limit import sync_rate_limit_record
from smartroute.models import (
    AuditAction,
    AuditLog,
    Budget,
    BudgetPeriod,
    RefreshToken,
    User,
    Workspace,
    WorkspaceMember,
    WorkspaceMemberRole,
)
from smartroute.schemas.auth import AuthTokens, AuthUser, LoginRequest, RegisterRequest, WorkspaceSummary
from smartroute.services.email_service import email_service

logger = logging.getLogger(__name__)

BCRYPT_ROUNDS = 12


class AuthService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    @staticmethod
    def _generate_slug(name: str) -> str:
        base = (
            re.sub(r"[^a-z0-9\s-]", "", name.lower())
            .replace(" ", "-")
        )
        base = re.sub(r"-+", "-", base)[:40]
        suffix = "".join(random.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(4))
        return f"{base}-{suffix}"

    async def register(self, data: RegisterRequest) -> dict:
        existing = await self.db.execute(select(User.id).where(User.email == data.email))
        if existing.scalar_one_or_none():
            raise AppError.conflict("Email already in use")

        if data.workspace_slug:
            slug_taken = await self.db.execute(
                select(Workspace.id).where(Workspace.slug == data.workspace_slug)
            )
            if slug_taken.scalar_one_or_none():
                raise AppError.conflict("Workspace slug already taken")

        hashed_password = bcrypt.hashpw(data.password.encode(), bcrypt.gensalt(BCRYPT_ROUNDS)).decode()

        new_user = User(
            email=data.email,
            name=data.name,
            hashed_password=hashed_password,
        )
        self.db.add(new_user)
        await self.db.flush()

        workspace_name = data.workspace_name or f"{data.name}'s Workspace"
        slug = data.workspace_slug or self._generate_slug(workspace_name)

        now = datetime.now(timezone.utc)
        period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        if period_start.month == 12:
            period_end = period_start.replace(year=period_start.year + 1, month=1, day=1) - timedelta(days=1)
        else:
            period_end = period_start.replace(month=period_start.month + 1, day=1) - timedelta(days=1)

        workspace = Workspace(
            name=workspace_name,
            slug=slug,
            members=[WorkspaceMember(user_id=new_user.id, role=WorkspaceMemberRole.OWNER.value)],
            budgets=[
                Budget(
                    name="Default Budget",
                    limit_usd=50,
                    period=BudgetPeriod.MONTHLY.value,
                    period_start_at=period_start,
                    period_end_at=period_end,
                )
            ],
        )
        self.db.add(workspace)
        await self.db.flush()

        self.db.add(
            AuditLog(
                user_id=new_user.id,
                workspace_id=workspace.id,
                action=AuditAction.USER_CREATED.value,
                resource_type="user",
                resource_id=new_user.id,
                metadata_={"email": new_user.email},
            )
        )

        tokens = await self._issue_tokens(new_user.id, workspace.id, data.email)
        await sync_rate_limit_record(self.db, workspace.id)
        auth_user = await self.get_auth_user(new_user.id)

        try:
            await self.send_verification_email(new_user.id)
        except Exception:
            pass

        return {"user": auth_user, "tokens": tokens}

    async def login(
        self,
        data: LoginRequest,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> dict:
        result = await self.db.execute(
            select(User.id, User.email, User.hashed_password, User.deleted_at, User.mfa_enabled).where(
                User.email == data.email
            )
        )
        user = result.one_or_none()
        if not user or user.deleted_at:
            raise AppError.unauthorized("Invalid credentials")

        if not bcrypt.checkpw(data.password.encode(), user.hashed_password.encode()):
            raise AppError.unauthorized("Invalid credentials")

        membership = await self.db.execute(
            select(WorkspaceMember.workspace_id)
            .where(WorkspaceMember.user_id == user.id)
            .order_by(WorkspaceMember.joined_at.asc())
            .limit(1)
        )
        workspace_id = membership.scalar_one_or_none()
        if not workspace_id:
            raise AppError.internal("No workspace found for user")

        if user.mfa_enabled:
            from smartroute.services.mfa_service import mfa_service

            return {
                "mfaRequired": True,
                "mfaToken": mfa_service.create_mfa_challenge(user.id, workspace_id, user.email),
            }

        return await self.finalize_login(
            user.id,
            workspace_id,
            user.email,
            ip_address,
            {},
            user_agent=user_agent,
        )

    async def finalize_login(
        self,
        user_id: str,
        workspace_id: str,
        email: str,
        ip_address: str | None = None,
        metadata: dict | None = None,
        *,
        user_agent: str | None = None,
    ) -> dict:
        db_user = await self.db.get(User, user_id)
        if db_user:
            db_user.last_login_at = datetime.now(timezone.utc)

        self.db.add(
            AuditLog(
                user_id=user_id,
                action=AuditAction.USER_LOGIN.value,
                ip_address=ip_address,
                metadata_={"email": email, **(metadata or {})},
            )
        )

        tokens = await self._issue_tokens(
            user_id,
            workspace_id,
            email,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        auth_user = await self.get_auth_user(user_id)
        return {"user": auth_user, "tokens": tokens}

    async def list_sessions(self, user_id: str) -> list[dict]:
        now = datetime.now(timezone.utc)
        result = await self.db.execute(
            select(RefreshToken)
            .where(
                RefreshToken.user_id == user_id,
                RefreshToken.revoked_at.is_(None),
                RefreshToken.expires_at > now,
            )
            .order_by(RefreshToken.created_at.desc())
        )
        sessions = result.scalars().all()
        return [
            {
                "id": s.id,
                "createdAt": s.created_at,
                "expiresAt": s.expires_at,
                "userAgent": s.user_agent,
                "ipAddress": s.ip_address,
            }
            for s in sessions
        ]

    async def revoke_session(self, user_id: str, session_id: str) -> None:
        result = await self.db.execute(
            select(RefreshToken).where(
                RefreshToken.id == session_id,
                RefreshToken.user_id == user_id,
                RefreshToken.revoked_at.is_(None),
            )
        )
        session = result.scalar_one_or_none()
        if not session:
            raise AppError.not_found("Session not found")
        session.revoked_at = datetime.now(timezone.utc)
        await self.db.flush()

    async def revoke_other_sessions(self, user_id: str, current_refresh_token: str) -> int:
        result = await self.db.execute(
            update(RefreshToken)
            .where(
                RefreshToken.user_id == user_id,
                RefreshToken.revoked_at.is_(None),
                RefreshToken.token != current_refresh_token,
            )
            .values(revoked_at=datetime.now(timezone.utc))
        )
        return result.rowcount or 0

    async def refresh_tokens(self, refresh_token: str) -> AuthTokens:
        result = await self.db.execute(
            select(RefreshToken).where(RefreshToken.token == refresh_token)
        )
        stored = result.scalar_one_or_none()
        if not stored or stored.revoked_at or stored.expires_at < datetime.now(timezone.utc):
            raise AppError.unauthorized("Refresh token expired or revoked")

        stored.revoked_at = datetime.now(timezone.utc)

        membership = await self.db.execute(
            select(WorkspaceMember.workspace_id)
            .where(WorkspaceMember.user_id == stored.user_id)
            .order_by(WorkspaceMember.joined_at.asc())
            .limit(1)
        )
        workspace_id = membership.scalar_one_or_none() or ""

        user = await self.db.get(User, stored.user_id)
        if not user:
            raise AppError.unauthorized("Invalid refresh token")

        return await self._issue_tokens(stored.user_id, workspace_id, user.email)

    async def switch_workspace(self, user_id: str, workspace_id: str) -> dict:
        membership = await self.db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.user_id == user_id,
                WorkspaceMember.workspace_id == workspace_id,
            )
        )
        if not membership.scalar_one_or_none():
            raise AppError.forbidden("You are not a member of this workspace")

        user = await self.db.get(User, user_id)
        if not user:
            raise AppError.not_found("User not found")

        tokens = await self._issue_tokens(user_id, workspace_id, user.email)
        auth_user = await self.get_auth_user(user_id)
        return {"user": auth_user, "tokens": tokens}

    async def request_password_reset(self, email: str) -> None:
        normalized = email.lower().strip()
        result = await self.db.execute(
            select(User.id, User.email, User.name, User.deleted_at).where(User.email == normalized)
        )
        user = result.one_or_none()
        if not user or user.deleted_at:
            return

        raw_token = secrets.token_hex(32)
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()

        db_user = await self.db.get(User, user.id)
        if db_user:
            db_user.password_reset_token_hash = token_hash
            db_user.password_reset_expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
            await self.db.flush()

        reset_url = f"{settings.web_base_url}/reset-password?token={raw_token}"
        sent = await email_service.send_password_reset(
            user.email,
            {"name": user.name, "resetUrl": reset_url},
        )
        if not sent and settings.NODE_ENV != "production":
            logger.info("Password reset email skipped — reset URL (dev only): %s", reset_url)

    async def reset_password(self, token: str, new_password: str) -> None:
        if len(new_password) < 8:
            raise AppError.bad_request("Password must be at least 8 characters")

        token_hash = hashlib.sha256(token.encode()).hexdigest()
        now = datetime.now(timezone.utc)

        result = await self.db.execute(
            select(User).where(
                User.password_reset_token_hash == token_hash,
                User.password_reset_expires_at > now,
                User.deleted_at.is_(None),
            )
        )
        user = result.scalar_one_or_none()
        if not user:
            raise AppError.bad_request("Invalid or expired reset link")

        user.hashed_password = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt(BCRYPT_ROUNDS)).decode()
        user.password_reset_token_hash = None
        user.password_reset_expires_at = None

        await self.db.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=now)
        )
        await self.db.flush()

    async def create_workspace(self, user_id: str, name: str) -> dict:
        slug = self._generate_slug(name)
        now = datetime.now(timezone.utc)
        period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        if period_start.month == 12:
            period_end = period_start.replace(year=period_start.year + 1, month=1, day=1) - timedelta(days=1)
        else:
            period_end = period_start.replace(month=period_start.month + 1, day=1) - timedelta(days=1)

        workspace = Workspace(
            name=name,
            slug=slug,
            members=[WorkspaceMember(user_id=user_id, role=WorkspaceMemberRole.OWNER.value)],
            budgets=[
                Budget(
                    name="Default Budget",
                    limit_usd=50,
                    period=BudgetPeriod.MONTHLY.value,
                    period_start_at=period_start,
                    period_end_at=period_end,
                )
            ],
        )
        self.db.add(workspace)
        await self.db.flush()

        self.db.add(
            AuditLog(
                user_id=user_id,
                workspace_id=workspace.id,
                action=AuditAction.WORKSPACE_CREATED.value,
                resource_type="workspace",
                resource_id=workspace.id,
                metadata_={"name": name},
            )
        )

        user = await self.db.get(User, user_id)
        if not user:
            raise AppError.not_found("User not found")

        tokens = await self._issue_tokens(user_id, workspace.id, user.email)
        await sync_rate_limit_record(self.db, workspace.id)
        auth_user = await self.get_auth_user(user_id)
        return {"user": auth_user, "tokens": tokens}

    async def send_verification_email(self, user_id: str) -> None:
        user = await self.db.get(User, user_id)
        if not user or user.deleted_at or user.email_verified:
            return

        raw_token = secrets.token_hex(32)
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()

        user.email_verification_token_hash = token_hash
        user.email_verification_expires_at = datetime.now(timezone.utc) + timedelta(hours=24)
        await self.db.flush()

        verify_url = f"{settings.web_base_url}/verify-email?token={raw_token}"
        sent = await email_service.send_email_verification(
            user.email,
            {"name": user.name, "verifyUrl": verify_url},
        )
        if not sent and settings.NODE_ENV != "production":
            logger.info("Verification email skipped — verify URL (dev only): %s", verify_url)

    async def update_profile(self, user_id: str, name: str) -> AuthUser:
        if len(name) < 2 or len(name) > 100:
            raise AppError.bad_request("Name must be 2–100 characters")

        user = await self.db.get(User, user_id)
        if not user:
            raise AppError.not_found("User not found")
        user.name = name
        await self.db.flush()
        return await self.get_auth_user(user_id)

    async def change_password(self, user_id: str, current_password: str, new_password: str) -> None:
        if len(new_password) < 8:
            raise AppError.bad_request("New password must be at least 8 characters")

        user = await self.db.get(User, user_id)
        if not user:
            raise AppError.not_found("User not found")

        if not bcrypt.checkpw(current_password.encode(), user.hashed_password.encode()):
            raise AppError.unauthorized("Current password is incorrect")

        user.hashed_password = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt(BCRYPT_ROUNDS)).decode()
        now = datetime.now(timezone.utc)
        await self.db.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=now)
        )
        await self.db.flush()

    async def verify_email(self, token: str) -> None:
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        now = datetime.now(timezone.utc)

        result = await self.db.execute(
            select(User).where(
                User.email_verification_token_hash == token_hash,
                User.email_verification_expires_at > now,
                User.deleted_at.is_(None),
            )
        )
        user = result.scalar_one_or_none()
        if not user:
            raise AppError.bad_request("Invalid or expired verification link")

        user.email_verified = True
        user.email_verification_token_hash = None
        user.email_verification_expires_at = None
        await self.db.flush()

    async def logout(self, refresh_token: str) -> None:
        await self.db.execute(
            update(RefreshToken)
            .where(RefreshToken.token == refresh_token)
            .values(revoked_at=datetime.now(timezone.utc))
        )

    async def _issue_tokens(
        self,
        user_id: str,
        workspace_id: str,
        email: str,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> AuthTokens:
        user = await self.db.get(User, user_id)
        if not user:
            raise AppError.not_found("User not found")

        access_token = jwt.encode(
            {"sub": user_id, "workspaceId": workspace_id, "email": email, "role": user.role},
            settings.JWT_SECRET,
            algorithm="HS256",
        )

        refresh_token_value = f"{uuid4()}-{uuid4()}"
        expires_at = datetime.now(timezone.utc) + timedelta(days=7)

        self.db.add(
            RefreshToken(
                user_id=user_id,
                token=refresh_token_value,
                expires_at=expires_at,
                ip_address=ip_address,
                user_agent=user_agent,
            )
        )
        await self.db.flush()

        return AuthTokens(
            accessToken=access_token,
            refreshToken=refresh_token_value,
            expiresIn=15 * 60,
        )

    async def login_or_register_oauth(self, data: dict) -> dict:
        result = await self.db.execute(select(User).where(User.email == data["email"]))
        user = result.scalar_one_or_none()

        if not user:
            register_result = await self.register(
                RegisterRequest(
                    name=data["name"],
                    email=data["email"],
                    password=secrets.token_hex(32),
                    workspaceName=f"{data['name']}'s Workspace",
                )
            )
            if data.get("avatarUrl"):
                db_user = await self.db.get(User, register_result["user"].id)
                if db_user:
                    db_user.avatar_url = data["avatarUrl"]
                    db_user.email_verified = True
                    await self.db.flush()
            return register_result

        user.last_login_at = datetime.now(timezone.utc)
        if data.get("avatarUrl"):
            user.avatar_url = data["avatarUrl"]
        await self.db.flush()

        membership = await self.db.execute(
            select(WorkspaceMember.workspace_id)
            .where(WorkspaceMember.user_id == user.id)
            .order_by(WorkspaceMember.joined_at.asc())
            .limit(1)
        )
        workspace_id = membership.scalar_one_or_none()
        if not workspace_id:
            raise AppError.internal("No workspace found for user")

        if user.mfa_enabled:
            from smartroute.services.mfa_service import mfa_service

            return {
                "mfaRequired": True,
                "mfaToken": mfa_service.create_mfa_challenge(user.id, workspace_id, user.email),
            }

        return await self.finalize_login(user.id, workspace_id, user.email)

    async def login_or_register_saml(self, params: dict) -> dict:
        email = params["email"].lower().strip()
        workspace_id = params["workspaceId"]

        result = await self.db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()

        if not user or user.deleted_at:
            hashed_password = bcrypt.hashpw(secrets.token_hex(32).encode(), bcrypt.gensalt(BCRYPT_ROUNDS)).decode()
            user = User(
                email=email,
                name=params.get("name") or email.split("@")[0],
                hashed_password=hashed_password,
                email_verified=True,
                role="USER",
            )
            self.db.add(user)
            await self.db.flush()
        elif params.get("name") and params["name"] != user.name:
            user.name = params["name"]
            await self.db.flush()

        membership_result = await self.db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.user_id == user.id,
                WorkspaceMember.workspace_id == workspace_id,
            )
        )
        membership = membership_result.scalar_one_or_none()

        if not membership:
            from smartroute.lib.plan_enforcement import enforce_member_limit

            await enforce_member_limit(self.db, workspace_id)
            membership = WorkspaceMember(
                workspace_id=workspace_id,
                user_id=user.id,
                role=WorkspaceMemberRole.MEMBER.value,
            )
            self.db.add(membership)
            await self.db.flush()
            self.db.add(
                AuditLog(
                    workspace_id=workspace_id,
                    user_id=user.id,
                    action=AuditAction.MEMBER_ADDED.value,
                    resource_type="member",
                    resource_id=membership.id,
                    metadata_={"via": "saml"},
                )
            )
            await self.db.flush()

        if user.mfa_enabled:
            from smartroute.services.mfa_service import mfa_service

            return {
                "mfaRequired": True,
                "mfaToken": mfa_service.create_mfa_challenge(user.id, workspace_id, user.email),
            }

        return await self.finalize_login(
            user.id,
            workspace_id,
            user.email,
            params.get("ipAddress"),
            {"via": "saml"},
            user_agent=params.get("userAgent"),
        )

    async def get_auth_user(self, user_id: str) -> AuthUser:
        result = await self.db.execute(
            select(User)
            .options(
                selectinload(User.workspace_memberships).selectinload(WorkspaceMember.workspace)
            )
            .where(User.id == user_id)
        )
        user = result.scalar_one()

        workspaces = [
            WorkspaceSummary(
                id=m.workspace.id,
                slug=m.workspace.slug,
                name=m.workspace.name,
                role=m.role,
            )
            for m in user.workspace_memberships
        ]

        return AuthUser(
            id=user.id,
            email=user.email,
            name=user.name,
            avatarUrl=user.avatar_url,
            role=user.role,
            emailVerified=user.email_verified,
            mfaEnabled=user.mfa_enabled,
            workspaces=workspaces,
        )

    async def export_user_data(self, user_id: str) -> dict:
        result = await self.db.execute(
            select(User).where(User.id == user_id, User.deleted_at.is_(None))
        )
        user = result.scalar_one_or_none()
        if not user:
            raise AppError.not_found("User not found")

        memberships = await self.db.execute(
            select(WorkspaceMember)
            .options(selectinload(WorkspaceMember.workspace))
            .where(WorkspaceMember.user_id == user_id)
        )
        members = memberships.scalars().all()

        now = datetime.now(timezone.utc)
        sessions_result = await self.db.execute(
            select(RefreshToken)
            .where(
                RefreshToken.user_id == user_id,
                RefreshToken.revoked_at.is_(None),
                RefreshToken.expires_at > now,
            )
            .order_by(RefreshToken.created_at.desc())
        )
        sessions = sessions_result.scalars().all()

        return {
            "exportedAt": datetime.now(timezone.utc).isoformat(),
            "user": {
                "id": user.id,
                "email": user.email,
                "name": user.name,
                "role": user.role,
                "emailVerified": user.email_verified,
                "mfaEnabled": user.mfa_enabled,
                "avatarUrl": user.avatar_url,
                "createdAt": user.created_at,
                "lastLoginAt": user.last_login_at,
            },
            "workspaces": [
                {
                    "id": m.workspace.id,
                    "slug": m.workspace.slug,
                    "name": m.workspace.name,
                    "plan": m.workspace.plan,
                    "role": m.role,
                    "joinedAt": m.joined_at,
                }
                for m in members
            ],
            "sessions": [
                {
                    "id": s.id,
                    "createdAt": s.created_at,
                    "expiresAt": s.expires_at,
                    "ipAddress": s.ip_address,
                    "userAgent": s.user_agent,
                }
                for s in sessions
            ],
        }

    async def delete_account(self, user_id: str, password: str) -> None:
        user = await self.db.get(User, user_id)
        if not user or user.deleted_at:
            raise AppError.not_found("User not found")

        if not bcrypt.checkpw(password.encode(), user.hashed_password.encode()):
            raise AppError.unauthorized("Password is incorrect")

        owned = await self.db.execute(
            select(WorkspaceMember)
            .options(selectinload(WorkspaceMember.workspace))
            .where(WorkspaceMember.user_id == user_id, WorkspaceMember.role == WorkspaceMemberRole.OWNER.value)
        )
        owned_memberships = owned.scalars().all()

        for membership in owned_memberships:
            if membership.workspace.deleted_at:
                continue
            count_result = await self.db.execute(
                select(WorkspaceMember.id).where(
                    WorkspaceMember.workspace_id == membership.workspace_id,
                    WorkspaceMember.user_id != user_id,
                )
            )
            if count_result.scalars().first():
                raise AppError.conflict(
                    f'Transfer ownership of "{membership.workspace.name}" before deleting your account',
                )

        random_password = bcrypt.hashpw(secrets.token_hex(32).encode(), bcrypt.gensalt(BCRYPT_ROUNDS)).decode()
        now = datetime.now(timezone.utc)

        for membership in owned_memberships:
            if membership.workspace.deleted_at:
                continue
            membership.workspace.deleted_at = now
            membership.workspace.is_active = False

        await self.db.execute(delete(WorkspaceMember).where(WorkspaceMember.user_id == user_id))
        await self.db.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=now)
        )

        user.deleted_at = now
        user.email = f"deleted-{user_id}@removed.local"
        user.name = "Deleted User"
        user.avatar_url = None
        user.mfa_enabled = False
        user.mfa_secret_encrypted = None
        user.mfa_backup_codes_hash = None
        user.hashed_password = random_password
        user.email_verification_token_hash = None
        user.email_verification_expires_at = None
        user.password_reset_token_hash = None
        user.password_reset_expires_at = None
        await self.db.flush()
