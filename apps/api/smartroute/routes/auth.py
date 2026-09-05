"""Auth routes — /api/v1/auth."""

from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from smartroute.db import get_db
from smartroute.lib.responses import success_response
from smartroute.middleware.auth import AuthPayload, get_client_ip, require_auth
from smartroute.schemas.auth import (
    ChangePasswordRequest,
    DeleteAccountRequest,
    ForgotPasswordRequest,
    LoginRequest,
    LogoutRequest,
    MfaCodeRequest,
    MfaDisableRequest,
    MfaVerifyLoginRequest,
    RefreshTokenRequest,
    RegisterRequest,
    ResetPasswordRequest,
    RevokeOthersRequest,
    SwitchWorkspaceRequest,
    UpdateProfileRequest,
    VerifyEmailRequest,
)
from smartroute.services.auth_service import AuthService
from smartroute.services.mfa_service import mfa_service

router = APIRouter(prefix="/auth", tags=["auth"])


def _ok(data: object, status_code: int = status.HTTP_200_OK) -> Response:
    return success_response(data, status_code=status_code)


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, db: Annotated[AsyncSession, Depends(get_db)]):
    result = await AuthService(db).register(body)
    return _ok(result, status.HTTP_201_CREATED)


@router.post("/login")
async def login(
    body: LoginRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    user_agent = request.headers.get("user-agent")
    result = await AuthService(db).login(body, get_client_ip(request), user_agent)
    return _ok(result)


@router.post("/refresh")
async def refresh(body: RefreshTokenRequest, db: Annotated[AsyncSession, Depends(get_db)]):
    tokens = await AuthService(db).refresh_tokens(body.refresh_token)
    return _ok(tokens)


@router.post("/logout")
async def logout(body: LogoutRequest, db: Annotated[AsyncSession, Depends(get_db)]):
    await AuthService(db).logout(body.refresh_token)
    return _ok({"message": "Logged out successfully"})


@router.get("/me")
async def me(user: Annotated[AuthPayload, Depends(require_auth)], db: Annotated[AsyncSession, Depends(get_db)]):
    auth_user = await AuthService(db).get_auth_user(user.sub)
    return _ok(auth_user)


@router.patch("/me")
async def update_me(
    body: UpdateProfileRequest,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    auth_user = await AuthService(db).update_profile(user.sub, body.name)
    return _ok(auth_user)


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await AuthService(db).change_password(user.sub, body.current_password, body.new_password)
    return _ok({"message": "Password updated. Please sign in again on other devices."})


@router.post("/forgot-password")
async def forgot_password(body: ForgotPasswordRequest, db: Annotated[AsyncSession, Depends(get_db)]):
    await AuthService(db).request_password_reset(body.email)
    return _ok({"message": "If that email exists, a reset link has been sent."})


@router.post("/reset-password")
async def reset_password(body: ResetPasswordRequest, db: Annotated[AsyncSession, Depends(get_db)]):
    await AuthService(db).reset_password(body.token, body.password)
    return _ok({"message": "Password updated. Please sign in again."})


@router.post("/switch-workspace")
async def switch_workspace(
    body: SwitchWorkspaceRequest,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await AuthService(db).switch_workspace(user.sub, str(body.workspace_id))
    return _ok(result)


@router.post("/verify-email")
async def verify_email(body: VerifyEmailRequest, db: Annotated[AsyncSession, Depends(get_db)]):
    await AuthService(db).verify_email(body.token)
    return _ok({"message": "Email verified successfully."})


@router.post("/resend-verification")
async def resend_verification(
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await AuthService(db).send_verification_email(user.sub)
    return _ok({"message": "If your email is unverified, a new link has been sent."})


@router.get("/mfa/status")
async def mfa_status(user: Annotated[AuthPayload, Depends(require_auth)], db: Annotated[AsyncSession, Depends(get_db)]):
    status_data = await mfa_service.get_status(db, user.sub)
    return _ok(status_data)


@router.post("/mfa/setup")
async def mfa_setup(user: Annotated[AuthPayload, Depends(require_auth)], db: Annotated[AsyncSession, Depends(get_db)]):
    setup = await mfa_service.setup(db, user.sub)
    return _ok(setup)


@router.post("/mfa/confirm")
async def mfa_confirm(
    body: MfaCodeRequest,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await mfa_service.confirm_setup(db, user.sub, body.code)
    auth_user = await AuthService(db).get_auth_user(user.sub)
    return _ok({**result, "user": auth_user})


@router.post("/mfa/disable")
async def mfa_disable(
    body: MfaDisableRequest,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await mfa_service.disable(db, user.sub, body.password, body.code)
    auth_user = await AuthService(db).get_auth_user(user.sub)
    return _ok({"user": auth_user})


@router.post("/mfa/verify-login")
async def mfa_verify_login(
    body: MfaVerifyLoginRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    user_agent = request.headers.get("user-agent")
    result = await mfa_service.complete_login(
        db,
        body.mfa_token,
        body.code,
        get_client_ip(request),
        user_agent,
    )
    return _ok(result)


@router.get("/sessions")
async def list_sessions(user: Annotated[AuthPayload, Depends(require_auth)], db: Annotated[AsyncSession, Depends(get_db)]):
    sessions = await AuthService(db).list_sessions(user.sub)
    return _ok(sessions)


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_session(
    session_id: str,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await AuthService(db).revoke_session(user.sub, session_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/sessions/revoke-others")
async def revoke_other_sessions(
    body: RevokeOthersRequest,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    count = await AuthService(db).revoke_other_sessions(user.sub, body.refresh_token)
    return _ok({"revokedCount": count})


@router.get("/me/export")
async def export_user_data(
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    data = await AuthService(db).export_user_data(user.sub)
    filename = f"smartroute-user-{user.sub[:8]}.json"
    return Response(
        content=json.dumps(data, indent=2, default=str),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("/me")
async def delete_account(
    body: DeleteAccountRequest,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await AuthService(db).delete_account(user.sub, body.password)
    return _ok({"message": "Account deleted successfully"})
