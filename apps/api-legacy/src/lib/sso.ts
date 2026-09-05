import { env } from '../config/env';

export interface SsoConfig {
  enabled: boolean;
  metadataUrl: string | null;
  entityId: string | null;
  idpConfigured: boolean;
  acsUrl: string;
  spEntityId: string;
  spMetadataUrl: string;
  loginUrl: string | null;
  implemented: boolean;
}

type WorkspaceSso = {
  id: string;
  slug: string;
  ssoEnabled: boolean;
  ssoMetadataUrl: string | null;
  ssoEntityId: string | null;
  ssoIdpSsoUrl?: string | null;
  ssoIdpCertPem?: string | null;
};

/** Builds SSO metadata for a workspace. */
export function buildSsoConfig(workspace: WorkspaceSso): SsoConfig {
  const base = env.API_BASE_URL.replace(/\/$/, '');
  const acsUrl = `${base}/api/v1/auth/saml/acs?workspace=${workspace.slug}`;
  const spEntityId = `${base}/sso/${workspace.slug}`;
  const spMetadataUrl = `${base}/api/v1/auth/saml/metadata?workspace=${workspace.slug}`;
  const idpConfigured = Boolean(workspace.ssoIdpSsoUrl && workspace.ssoIdpCertPem);

  return {
    enabled: workspace.ssoEnabled,
    metadataUrl: workspace.ssoMetadataUrl,
    entityId: workspace.ssoEntityId,
    idpConfigured,
    acsUrl,
    spEntityId,
    spMetadataUrl,
    loginUrl: workspace.ssoEnabled && idpConfigured
      ? `${base}/api/v1/auth/saml/login?workspace=${workspace.slug}`
      : null,
    implemented: idpConfigured,
  };
}

/** Minimal SP metadata XML for IdP configuration previews. */
export function buildSpMetadataXml(config: SsoConfig): string {
  return `<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${config.spEntityId}">
  <SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${config.acsUrl}" index="0"/>
  </SPSSODescriptor>
</EntityDescriptor>`;
}

/** Parse IdP metadata XML for SSO URL and X509 certificate. */
export function parseIdpMetadata(xml: string): { entryPoint: string; certPem: string; entityId?: string } {
  const entityId = xml.match(/entityID="([^"]+)"/)?.[1];

  const ssoMatch =
    xml.match(
      /<(?:[\w]+:)?SingleSignOnService[^>]*Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"[^>]*Location="([^"]+)"/,
    ) ??
    xml.match(
      /<(?:[\w]+:)?SingleSignOnService[^>]*Location="([^"]+)"[^>]*Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"/,
    ) ??
    xml.match(/<(?:[\w]+:)?SingleSignOnService[^>]*Location="([^"]+)"/);

  const entryPoint = ssoMatch?.[1];
  if (!entryPoint) throw new Error('IdP metadata missing SingleSignOnService URL');

  const certBody = xml.match(/<(?:[\w]+:)?X509Certificate>([^<]+)<\/(?:[\w]+:)?X509Certificate>/)?.[1];
  if (!certBody) throw new Error('IdP metadata missing X509Certificate');

  const certPem = `-----BEGIN CERTIFICATE-----\n${certBody.replace(/\s+/g, '')}\n-----END CERTIFICATE-----`;

  return { entryPoint, certPem, entityId };
}

/** Fetch and parse remote IdP metadata document. */
export async function fetchIdpMetadata(metadataUrl: string) {
  const res = await fetch(metadataUrl, { headers: { Accept: 'application/xml, text/xml' } });
  if (!res.ok) throw new Error(`Failed to fetch IdP metadata (${res.status})`);
  const xml = await res.text();
  return parseIdpMetadata(xml);
}
