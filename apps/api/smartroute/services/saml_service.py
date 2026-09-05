"""SAML authentication service."""

from __future__ import annotations

import os
from typing import Any
from urllib.parse import urlparse

from onelogin.saml2.auth import OneLogin_Saml2_Auth

from smartroute.config import settings
from smartroute.errors import AppError
from smartroute.lib.sso import build_sso_config

E2E_ASSERTION_PREFIX = "e2e-test-assertion:"


def _parse_e2e_saml_assertion(response: str | None) -> dict[str, str] | None:
    if os.getenv("SAML_E2E_BYPASS", "").lower() != "true" and not settings.SAML_E2E_BYPASS:
        return None
    if not response or not response.startswith(E2E_ASSERTION_PREFIX):
        return None

    payload = response[len(E2E_ASSERTION_PREFIX) :]
    email, _, name = payload.partition("|")
    if "@" not in email:
        raise AppError.unauthorized("E2E SAML assertion requires a valid email")
    return {
        "email": email.lower().strip(),
        "name": name.strip() or email.split("@")[0],
    }


def _build_saml_settings(workspace) -> dict[str, Any]:
    config = build_sso_config(workspace)
    if not workspace.sso_idp_sso_url or not workspace.sso_idp_cert_pem:
        raise AppError.bad_request(
            "SSO IdP is not fully configured. Save a valid metadata URL in Settings."
        )

    return {
        "strict": True,
        "debug": settings.NODE_ENV == "development",
        "sp": {
            "entityId": config["spEntityId"],
            "assertionConsumerService": {
                "url": config["acsUrl"],
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST",
            },
        },
        "idp": {
            "entityId": workspace.sso_entity_id or workspace.sso_idp_sso_url,
            "singleSignOnService": {
                "url": workspace.sso_idp_sso_url,
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
            },
            "x509cert": workspace.sso_idp_cert_pem.replace("-----BEGIN CERTIFICATE-----", "")
            .replace("-----END CERTIFICATE-----", "")
            .replace("\n", "")
            .strip(),
        },
        "security": {
            "wantAssertionsSigned": True,
            "wantMessagesSigned": False,
        },
    }


def _prepare_request(req: dict[str, Any]) -> dict[str, Any]:
    return {
        "https": "on" if req.get("https") else "off",
        "http_host": req.get("http_host", "localhost"),
        "script_name": req.get("script_name", ""),
        "server_port": req.get("server_port", "443"),
        "get_data": req.get("get_data", {}),
        "post_data": req.get("post_data", {}),
    }


async def create_saml_login_redirect(workspace, request_url: str) -> str:
    parsed = urlparse(request_url)
    req = _prepare_request(
        {
            "https": parsed.scheme == "https",
            "http_host": parsed.netloc,
            "script_name": parsed.path,
            "server_port": str(parsed.port or (443 if parsed.scheme == "https" else 80)),
        }
    )
    auth = OneLogin_Saml2_Auth(req, _build_saml_settings(workspace))
    return auth.login(return_to=None, force_authn=True)


async def validate_saml_response(workspace, body: dict[str, str], request_url: str) -> dict[str, str]:
    e2e_user = _parse_e2e_saml_assertion(body.get("SAMLResponse"))
    if e2e_user:
        return e2e_user

    parsed = urlparse(request_url)
    req = _prepare_request(
        {
            "https": parsed.scheme == "https",
            "http_host": parsed.netloc,
            "script_name": parsed.path,
            "server_port": str(parsed.port or (443 if parsed.scheme == "https" else 80)),
            "post_data": body,
        }
    )
    auth = OneLogin_Saml2_Auth(req, _build_saml_settings(workspace))
    auth.process_response()
    errors = auth.get_errors()
    if errors:
        raise AppError.unauthorized(auth.get_last_error_reason() or "SAML validation failed")

    attributes = auth.get_attributes()
    email = (
        (attributes.get("email") or [None])[0]
        or (attributes.get("Email") or [None])[0]
        or auth.get_nameid()
    )
    if not email or "@" not in email:
        raise AppError.unauthorized("SAML assertion did not include a valid email")

    display_name = (
        (attributes.get("displayName") or attributes.get("name") or [None])[0]
        or email.split("@")[0]
    )
    return {"email": email.lower().strip(), "name": display_name}
