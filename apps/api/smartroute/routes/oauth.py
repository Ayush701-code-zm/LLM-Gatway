"""Google OAuth routes — /api/v1/auth/oauth."""

from __future__ import annotations

import logging
from typing import Annotated
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from smartroute.config import settings
from smartroute.db import get_db
from smartroute.errors import AppError
from smartroute.services.auth_service import AuthService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth/oauth", tags=["oauth"])

OAUTH_E2E_PREFIX = "e2e-test-oauth:"


@router.get("/google")
async def google_oauth_start():
    if not settings.GOOGLE_CLIENT_ID or not settings.OAUTH_REDIRECT_URI:
        raise AppError.bad_request("Google OAuth is not configured")

    params = urlencode(
        {
            "client_id": settings.GOOGLE_CLIENT_ID,
            "redirect_uri": settings.OAUTH_REDIRECT_URI,
            "response_type": "code",
            "scope": "openid email profile",
            "access_type": "offline",
            "prompt": "consent",
        }
    )
    return RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{params}")


def _parse_e2e_oauth_code(code: str | None) -> dict[str, str] | None:
    if not settings.OAUTH_E2E_BYPASS or not code or not code.startswith(OAUTH_E2E_PREFIX):
        return None

    payload = code[len(OAUTH_E2E_PREFIX) :]
    parts = payload.split("|", 1)
    email = parts[0].lower().strip() if parts else ""
    name = parts[1].strip() if len(parts) > 1 else email.split("@")[0]

    if "@" not in email:
        raise AppError.bad_request("E2E OAuth code requires a valid email")

    return {"email": email, "name": name}


def _redirect_oauth_result(result: dict) -> RedirectResponse:
    redirect_url = f"{settings.web_base_url}/oauth/callback"

    if result.get("mfaRequired"):
        redirect_url = f"{redirect_url}?mfaToken={result['mfaToken']}"
        return RedirectResponse(redirect_url)

    tokens = result.get("tokens")
    if tokens:
        token_data = tokens.model_dump(by_alias=True) if hasattr(tokens, "model_dump") else tokens
        redirect_url = (
            f"{redirect_url}?accessToken={token_data['accessToken']}&refreshToken={token_data['refreshToken']}"
        )

    return RedirectResponse(redirect_url)


@router.get("/google/callback")
async def google_oauth_callback(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    code: Annotated[str | None, Query()] = None,
):
    try:
        e2e_user = _parse_e2e_oauth_code(code)
        auth_service = AuthService(db)

        if e2e_user:
            result = await auth_service.login_or_register_oauth(
                {
                    "email": e2e_user["email"],
                    "name": e2e_user["name"],
                    "provider": "google",
                    "providerId": f"e2e-{e2e_user['email']}",
                }
            )
            return _redirect_oauth_result(result)

        if not code:
            raise AppError.bad_request("Missing authorization code")

        if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET or not settings.OAUTH_REDIRECT_URI:
            raise AppError.bad_request("Google OAuth is not configured")

        async with httpx.AsyncClient() as client:
            token_res = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "code": code,
                    "client_id": settings.GOOGLE_CLIENT_ID,
                    "client_secret": settings.GOOGLE_CLIENT_SECRET,
                    "redirect_uri": settings.OAUTH_REDIRECT_URI,
                    "grant_type": "authorization_code",
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            if not token_res.is_success:
                raise AppError.unauthorized("Google token exchange failed")

            tokens = token_res.json()
            profile_res = await client.get(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                headers={"Authorization": f"Bearer {tokens['access_token']}"},
            )
            if not profile_res.is_success:
                raise AppError.unauthorized("Failed to fetch Google profile")

            profile = profile_res.json()

        result = await auth_service.login_or_register_oauth(
            {
                "email": profile["email"],
                "name": profile["name"],
                "avatarUrl": profile.get("picture"),
                "provider": "google",
                "providerId": profile["id"],
            }
        )
        return _redirect_oauth_result(result)
    except Exception:
        logger.exception("Google OAuth callback failed")
        raise
