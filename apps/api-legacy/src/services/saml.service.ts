import { SAML } from '@node-saml/node-saml';
import { buildSsoConfig } from '../lib/sso';
import { AppError } from '../middleware/errorHandler';

const E2E_ASSERTION_PREFIX = 'e2e-test-assertion:';

/** Test-only SAML bypass for Playwright. Format: `e2e-test-assertion:email|Name` */
function parseE2eSamlAssertion(response: string | undefined): { email: string; name: string } | null {
  if (process.env.SAML_E2E_BYPASS !== 'true' || !response?.startsWith(E2E_ASSERTION_PREFIX)) {
    return null;
  }

  const payload = response.slice(E2E_ASSERTION_PREFIX.length);
  const [email, name] = payload.split('|');
  if (!email?.includes('@')) {
    throw AppError.unauthorized('E2E SAML assertion requires a valid email');
  }

  return {
    email: email.toLowerCase().trim(),
    name: name?.trim() || email.split('@')[0],
  };
}

type WorkspaceSaml = {
  id: string;
  slug: string;
  ssoEnabled: boolean;
  ssoMetadataUrl: string | null;
  ssoEntityId: string | null;
  ssoIdpSsoUrl: string | null;
  ssoIdpCertPem: string | null;
};

function createSamlClient(workspace: WorkspaceSaml): SAML {
  const config = buildSsoConfig(workspace);

  if (!workspace.ssoIdpSsoUrl || !workspace.ssoIdpCertPem) {
    throw AppError.badRequest('SSO IdP is not fully configured. Save a valid metadata URL in Settings.');
  }

  return new SAML({
    entryPoint: workspace.ssoIdpSsoUrl,
    issuer: config.spEntityId,
    callbackUrl: config.acsUrl,
    idpCert: workspace.ssoIdpCertPem,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    identifierFormat: 'urn:oasis:names:names:tc:SAML:1.1:nameid-format:emailAddress',
  });
}

export async function createSamlLoginRedirect(workspace: WorkspaceSaml): Promise<string> {
  const saml = createSamlClient(workspace);
  return saml.getAuthorizeUrlAsync('', undefined, {});
}

export async function validateSamlResponse(
  workspace: WorkspaceSaml,
  body: Record<string, string>,
): Promise<{ email: string; name: string }> {
  const e2eUser = parseE2eSamlAssertion(body.SAMLResponse);
  if (e2eUser) return e2eUser;

  const saml = createSamlClient(workspace);
  const { profile } = await saml.validatePostResponseAsync(body);

  const email =
    (profile.email as string | undefined) ??
    (profile.nameID as string | undefined)?.toLowerCase();

  if (!email || !email.includes('@')) {
    throw AppError.unauthorized('SAML assertion did not include a valid email');
  }

  const name =
    (profile.displayName as string | undefined) ??
    (profile.firstName as string | undefined) ??
    email.split('@')[0];

  return { email: email.toLowerCase().trim(), name };
}
