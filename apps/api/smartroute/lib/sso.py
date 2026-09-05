"""SSO configuration helpers."""

from __future__ import annotations

import re

import httpx

from smartroute.config import settings


def build_sso_config(workspace) -> dict:
    base = settings.API_BASE_URL.rstrip("/")
    acs_url = f"{base}/api/v1/auth/saml/acs?workspace={workspace.slug}"
    sp_entity_id = f"{base}/sso/{workspace.slug}"
    sp_metadata_url = f"{base}/api/v1/auth/saml/metadata?workspace={workspace.slug}"
    idp_configured = bool(workspace.sso_idp_sso_url and workspace.sso_idp_cert_pem)

    return {
        "enabled": workspace.sso_enabled,
        "metadataUrl": workspace.sso_metadata_url,
        "entityId": workspace.sso_entity_id,
        "idpConfigured": idp_configured,
        "acsUrl": acs_url,
        "spEntityId": sp_entity_id,
        "spMetadataUrl": sp_metadata_url,
        "loginUrl": f"{base}/api/v1/auth/saml/login?workspace={workspace.slug}"
        if workspace.sso_enabled and idp_configured
        else None,
        "implemented": idp_configured,
    }


def build_sp_metadata_xml(config: dict) -> str:
    return f"""<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="{config["spEntityId"]}">
  <SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="{config["acsUrl"]}" index="0"/>
  </SPSSODescriptor>
</EntityDescriptor>"""


def parse_idp_metadata(xml: str) -> dict[str, str | None]:
    entity_id = re.search(r'entityID="([^"]+)"', xml)
    sso_match = (
        re.search(
            r'<(?:[\w]+:)?SingleSignOnService[^>]*Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"[^>]*Location="([^"]+)"',
            xml,
        )
        or re.search(
            r'<(?:[\w]+:)?SingleSignOnService[^>]*Location="([^"]+)"[^>]*Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"',
            xml,
        )
        or re.search(r'<(?:[\w]+:)?SingleSignOnService[^>]*Location="([^"]+)"', xml)
    )

    entry_point = sso_match.group(1) if sso_match else None
    if not entry_point:
        raise ValueError("IdP metadata missing SingleSignOnService URL")

    cert_match = re.search(r"<(?:[\w]+:)?X509Certificate>([^<]+)</(?:[\w]+:)?X509Certificate>", xml)
    if not cert_match:
        raise ValueError("IdP metadata missing X509Certificate")

    cert_body = re.sub(r"\s+", "", cert_match.group(1))
    cert_pem = f"-----BEGIN CERTIFICATE-----\n{cert_body}\n-----END CERTIFICATE-----"

    return {
        "entryPoint": entry_point,
        "certPem": cert_pem,
        "entityId": entity_id.group(1) if entity_id else None,
    }


async def fetch_idp_metadata(metadata_url: str) -> dict[str, str | None]:
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(metadata_url, headers={"Accept": "application/xml, text/xml"})
        if response.status_code >= 400:
            raise ValueError(f"Failed to fetch IdP metadata ({response.status_code})")
        return parse_idp_metadata(response.text)
