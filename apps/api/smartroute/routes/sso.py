"""SSO and SAML routes."""

from __future__ import annotations

from typing import Annotated
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Form, Query, Request, status
from fastapi.responses import PlainTextResponse, RedirectResponse, Response
from pydantic import BaseModel, HttpUrl
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smartroute.config import settings
from smartroute.config.logger import logger
from smartroute.db import get_db
from smartroute.errors import AppError
from smartroute.lib.sso import build_sp_metadata_xml, build_sso_config, fetch_idp_metadata
from smartroute.middleware.auth import (
    AuthPayload,
    can_admin,
    get_auth_user_id,
    get_auth_workspace_id,
    get_client_ip,
    load_workspace_role,
    require_auth,
)
from smartroute.models import AuditAction, AuditLog, Workspace
from smartroute.services.auth_service import AuthService
from smartroute.services.saml_service import create_saml_login_redirect, validate_saml_response

workspace_router = APIRouter(prefix="/workspaces", tags=["sso"])
saml_router = APIRouter(prefix="/auth/saml", tags=["saml"])

WORKSPACE_SSO_FIELDS = (
    Workspace.id,
    Workspace.slug,
    Workspace.name,
    Workspace.plan,
    Workspace.sso_enabled,
    Workspace.sso_metadata_url,
    Workspace.sso_entity_id,
    Workspace.sso_idp_sso_url,
    Workspace.sso_idp_cert_pem,
)


class PatchSsoRequest(BaseModel):
    enabled: bool | None = None
    metadataUrl: HttpUrl | None = None
    entityId: str | None = None

    model_config = {"extra": "forbid"}


from smartroute.lib.responses import success_response


def _ok(data: object) -> Response:
    return success_response(data)


async def _require_enterprise(db: AsyncSession, workspace_id: str) -> Workspace:
    result = await db.execute(select(Workspace).where(Workspace.id == workspace_id))
    workspace = result.scalar_one_or_none()
    if not workspace:
        raise AppError.not_found("Workspace not found")
    if workspace.plan != "ENTERPRISE":
        raise AppError.forbidden("SSO is available on the Enterprise plan only")
    return workspace


async def _load_workspace_by_slug(db: AsyncSession, slug: str) -> Workspace | None:
    result = await db.execute(select(Workspace).where(Workspace.slug == slug))
    return result.scalar_one_or_none()


def _redirect_to_web(result: dict) -> RedirectResponse:
    redirect_url = f"{settings.web_base_url}/saml/callback"
    if result.get("mfaRequired"):
        redirect_url += "?" + urlencode({"mfaToken": result["mfaToken"]})
        return RedirectResponse(url=redirect_url, status_code=status.HTTP_302_FOUND)

    tokens = result.get("tokens")
    if tokens:
        token_data = tokens.model_dump(by_alias=True) if hasattr(tokens, "model_dump") else tokens
        redirect_url += "?" + urlencode(
            {
                "accessToken": token_data["accessToken"],
                "refreshToken": token_data["refreshToken"],
            }
        )
    return RedirectResponse(url=redirect_url, status_code=status.HTTP_302_FOUND)


@workspace_router.get("/current/sso", dependencies=[Depends(require_auth), Depends(load_workspace_role), Depends(can_admin)])
async def get_current_sso(
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    workspace = await _require_enterprise(db, get_auth_workspace_id(user))
    return _ok(build_sso_config(workspace))


@workspace_router.patch("/current/sso", dependencies=[Depends(require_auth), Depends(load_workspace_role), Depends(can_admin)])
async def patch_current_sso(
    body: PatchSsoRequest,
    user: Annotated[AuthPayload, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    workspace_id = get_auth_workspace_id(user)
    await _require_enterprise(db, workspace_id)

    payload = body.model_dump(exclude_unset=True)
    idp_update: dict[str, str | None] = {}
    if "metadataUrl" in payload:
        if payload["metadataUrl"] is None:
            idp_update = {"sso_idp_sso_url": None, "sso_idp_cert_pem": None}
        else:
            try:
                parsed = await fetch_idp_metadata(str(payload["metadataUrl"]))
                idp_update = {
                    "sso_idp_sso_url": parsed["entryPoint"],
                    "sso_idp_cert_pem": parsed["certPem"],
                }
            except Exception as exc:
                raise AppError.bad_request(str(exc)) from exc

    workspace = await db.get(Workspace, workspace_id)
    if not workspace:
        raise AppError.not_found("Workspace not found")
    if body.enabled is not None:
        workspace.sso_enabled = body.enabled
    if "metadataUrl" in payload:
        workspace.sso_metadata_url = str(body.metadataUrl) if body.metadataUrl else None
    if body.entityId is not None:
        workspace.sso_entity_id = body.entityId
    if idp_update:
        workspace.sso_idp_sso_url = idp_update.get("sso_idp_sso_url")
        workspace.sso_idp_cert_pem = idp_update.get("sso_idp_cert_pem")

    db.add(
        AuditLog(
            workspace_id=workspace_id,
            user_id=get_auth_user_id(user),
            action=AuditAction.SETTINGS_UPDATED.value,
            resource_type="sso",
            metadata_={
                "enabled": workspace.sso_enabled,
                "idpConfigured": bool(workspace.sso_idp_sso_url),
            },
        )
    )
    await db.flush()
    return _ok(build_sso_config(workspace))


@saml_router.get("/discover")
async def saml_discover(
    db: Annotated[AsyncSession, Depends(get_db)],
    workspace: str | None = Query(None),
):
    if not workspace:
        raise AppError.bad_request("workspace query parameter is required")

    ws = await _load_workspace_by_slug(db, workspace)
    if not ws or ws.plan != "ENTERPRISE":
        return _ok({"enabled": False})

    config = build_sso_config(ws)
    return _ok(
        {
            "enabled": config["enabled"] and config["implemented"],
            "workspaceName": ws.name,
            "loginUrl": config["loginUrl"],
        }
    )


@saml_router.get("/login")
async def saml_login(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    workspace: str | None = Query(None),
):
    if not workspace:
        raise AppError.bad_request("workspace query parameter is required")

    ws = await _load_workspace_by_slug(db, workspace)
    if not ws or ws.plan != "ENTERPRISE" or not ws.sso_enabled:
        raise AppError.not_found("SSO is not enabled for this workspace")

    redirect_url = await create_saml_login_redirect(ws, str(request.url))
    return RedirectResponse(url=redirect_url, status_code=status.HTTP_302_FOUND)


@saml_router.post("/acs")
async def saml_acs(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    workspace: str | None = Query(None),
    SAMLResponse: Annotated[str | None, Form()] = None,
    RelayState: Annotated[str | None, Form()] = None,
):
    if not workspace:
        raise AppError.bad_request("workspace query parameter is required")

    ws = await _load_workspace_by_slug(db, workspace)
    if not ws or ws.plan != "ENTERPRISE" or not ws.sso_enabled:
        raise AppError.not_found("SSO is not enabled for this workspace")

    body = {"SAMLResponse": SAMLResponse or "", "RelayState": RelayState or ""}
    try:
        profile = await validate_saml_response(ws, body, str(request.url))
        result = await AuthService(db).login_or_register_saml(
            {
                "email": profile["email"],
                "name": profile["name"],
                "workspaceId": ws.id,
                "ipAddress": get_client_ip(request),
                "userAgent": request.headers.get("user-agent"),
            }
        )
        return _redirect_to_web(result)
    except Exception as exc:
        logger.error("saml_acs_failed", err=str(exc))
        raise


@saml_router.get("/metadata")
async def saml_metadata(
    db: Annotated[AsyncSession, Depends(get_db)],
    workspace: str | None = Query(None),
):
    if not workspace:
        raise AppError.bad_request("workspace query parameter is required")

    ws = await _load_workspace_by_slug(db, workspace)
    if not ws or ws.plan != "ENTERPRISE":
        raise AppError.not_found("SSO metadata not available")

    config = build_sso_config(ws)
    return PlainTextResponse(content=build_sp_metadata_xml(config), media_type="application/xml")
