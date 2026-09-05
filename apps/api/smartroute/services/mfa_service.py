"""Multi-factor authentication service."""

from __future__ import annotations

import secrets
from typing import TypedDict

import bcrypt
import pyotp
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smartroute.config import settings
from smartroute.errors import AppError
from smartroute.lib.crypto import decrypt_secret, encrypt_secret
from smartroute.models import User
from smartroute.schemas.auth import AuthTokens, AuthUser

MFA_ISSUER = "SmartRoute AI"
BACKUP_CODE_COUNT = 8
BCRYPT_ROUNDS = 12


class MfaSetupResult(TypedDict):
    otpauthUrl: str
    secret: str


class LoginResult(TypedDict, total=False):
    mfaRequired: bool
    mfaToken: str
    user: AuthUser
    tokens: AuthTokens


def _generate_backup_codes() -> list[str]:
    return [secrets.token_hex(4).upper() for _ in range(BACKUP_CODE_COUNT)]


async def _hash_backup_codes(codes: list[str]) -> list[str]:
    return [
        bcrypt.hashpw(code.encode(), bcrypt.gensalt(BCRYPT_ROUNDS)).decode()
        for code in codes
    ]


def _issue_mfa_token(user_id: str, workspace_id: str, email: str) -> str:
    return jwt.encode(
        {"sub": user_id, "workspaceId": workspace_id, "email": email, "purpose": "mfa"},
        settings.JWT_SECRET,
        algorithm="HS256",
    )


def _verify_mfa_token(mfa_token: str) -> dict[str, str]:
    try:
        payload = jwt.decode(mfa_token, settings.JWT_SECRET, algorithms=["HS256"])
    except JWTError as exc:
        raise AppError.unauthorized("MFA session expired. Please sign in again.") from exc

    if payload.get("purpose") != "mfa" or not payload.get("sub") or not payload.get("workspaceId"):
        raise AppError.unauthorized("Invalid MFA session")

    return {
        "userId": payload["sub"],
        "workspaceId": payload["workspaceId"],
        "email": payload.get("email", ""),
    }


class MfaService:
    async def _verify_totp_or_backup(
        self,
        db: AsyncSession,
        user_id: str,
        code: str,
        consume_backup: bool = True,
    ) -> None:
        normalized = code.replace(" ", "").upper()
        result = await db.execute(
            select(User.mfa_secret_encrypted, User.mfa_backup_codes_hash).where(User.id == user_id)
        )
        user = result.one()

        if user.mfa_secret_encrypted:
            secret = decrypt_secret(user.mfa_secret_encrypted)
            totp = pyotp.TOTP(secret)
            if totp.verify(normalized, valid_window=1):
                return

        hashes = user.mfa_backup_codes_hash or []
        if isinstance(hashes, list):
            for index, hashed in enumerate(hashes):
                if bcrypt.checkpw(normalized.encode(), hashed.encode()):
                    if consume_backup:
                        remaining = [h for i, h in enumerate(hashes) if i != index]
                        db_user = await db.get(User, user_id)
                        if db_user:
                            db_user.mfa_backup_codes_hash = remaining or None
                            await db.flush()
                    return

        raise AppError.unauthorized("Invalid authentication code")

    async def get_status(self, db: AsyncSession, user_id: str) -> dict[str, int | bool]:
        result = await db.execute(
            select(User.mfa_enabled, User.mfa_backup_codes_hash).where(User.id == user_id)
        )
        user = result.one()
        hashes = user.mfa_backup_codes_hash or []
        return {
            "enabled": user.mfa_enabled,
            "backupCodesRemaining": len(hashes) if isinstance(hashes, list) else 0,
        }

    async def setup(self, db: AsyncSession, user_id: str) -> MfaSetupResult:
        result = await db.execute(
            select(User.email, User.mfa_enabled).where(User.id == user_id)
        )
        user = result.one()
        if user.mfa_enabled:
            raise AppError.bad_request("MFA is already enabled")

        secret = pyotp.random_base32()
        db_user = await db.get(User, user_id)
        if not db_user:
            raise AppError.not_found("User not found")

        db_user.mfa_secret_encrypted = encrypt_secret(secret)
        db_user.mfa_enabled = False
        db_user.mfa_backup_codes_hash = None
        await db.flush()

        totp = pyotp.TOTP(secret)
        return {
            "secret": secret,
            "otpauthUrl": totp.provisioning_uri(name=user.email, issuer_name=MFA_ISSUER),
        }

    async def confirm_setup(self, db: AsyncSession, user_id: str, code: str) -> dict[str, list[str]]:
        await self._verify_totp_or_backup(db, user_id, code, consume_backup=False)

        backup_codes = _generate_backup_codes()
        hashed = await _hash_backup_codes(backup_codes)

        db_user = await db.get(User, user_id)
        if not db_user:
            raise AppError.not_found("User not found")
        db_user.mfa_enabled = True
        db_user.mfa_backup_codes_hash = hashed
        await db.flush()

        return {"backupCodes": backup_codes}

    async def disable(self, db: AsyncSession, user_id: str, password: str, code: str) -> None:
        result = await db.execute(
            select(User.hashed_password, User.mfa_enabled).where(User.id == user_id)
        )
        user = result.one()
        if not user.mfa_enabled:
            raise AppError.bad_request("MFA is not enabled")

        if not bcrypt.checkpw(password.encode(), user.hashed_password.encode()):
            raise AppError.unauthorized("Incorrect password")

        await self._verify_totp_or_backup(db, user_id, code)

        db_user = await db.get(User, user_id)
        if not db_user:
            raise AppError.not_found("User not found")
        db_user.mfa_enabled = False
        db_user.mfa_secret_encrypted = None
        db_user.mfa_backup_codes_hash = None
        await db.flush()

    async def complete_login(
        self,
        db: AsyncSession,
        mfa_token: str,
        code: str,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> dict:
        from smartroute.services.auth_service import AuthService

        session = _verify_mfa_token(mfa_token)
        result = await db.execute(
            select(User.mfa_enabled, User.deleted_at).where(User.id == session["userId"])
        )
        user = result.one()
        if not user.mfa_enabled or user.deleted_at:
            raise AppError.unauthorized("Invalid MFA session")

        await self._verify_totp_or_backup(db, session["userId"], code)

        auth_service = AuthService(db)
        return await auth_service.finalize_login(
            session["userId"],
            session["workspaceId"],
            session["email"],
            ip_address,
            {"mfa": True},
            user_agent=user_agent,
        )

    def create_mfa_challenge(self, user_id: str, workspace_id: str, email: str) -> str:
        return _issue_mfa_token(user_id, workspace_id, email)


mfa_service = MfaService()
