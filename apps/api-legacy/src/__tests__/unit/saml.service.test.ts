import { describe, it, expect } from 'vitest';
import { validateSamlResponse } from '../../services/saml.service';

const STUB_WORKSPACE = {
  id: 'ws-enterprise',
  slug: 'acme-enterprise',
  ssoEnabled: true,
  ssoMetadataUrl: null,
  ssoEntityId: null,
  ssoIdpSsoUrl: 'https://stub.idp.example/saml/sso',
  ssoIdpCertPem: '-----BEGIN CERTIFICATE-----\nstub\n-----END CERTIFICATE-----',
};

describe('validateSamlResponse E2E bypass', () => {
  it('accepts e2e-test-assertion payload in test NODE_ENV', async () => {
    const result = await validateSamlResponse(STUB_WORKSPACE, {
      SAMLResponse: 'e2e-test-assertion:sso-user@example.com|SSO User',
    });

    expect(result.email).toBe('sso-user@example.com');
    expect(result.name).toBe('SSO User');
  });

  it('derives name from email when omitted', async () => {
    const result = await validateSamlResponse(STUB_WORKSPACE, {
      SAMLResponse: 'e2e-test-assertion:only-email@example.com',
    });

    expect(result.email).toBe('only-email@example.com');
    expect(result.name).toBe('only-email');
  });
});
