import { describe, it, expect } from 'vitest';
import { parseIdpMetadata, buildSsoConfig } from '../../lib/sso';

const SAMPLE_METADATA = `<?xml version="1.0"?>
<EntityDescriptor entityID="urn:idp:example" xmlns="urn:oasis:names:tc:SAML:2.0:metadata">
  <IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <KeyDescriptor use="signing">
      <KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#">
        <X509Data>
          <X509Certificate>MIICertDataHere1234567890</X509Certificate>
        </X509Data>
      </KeyInfo>
    </KeyDescriptor>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"
      Location="https://idp.example.com/sso/saml"/>
  </IDPSSODescriptor>
</EntityDescriptor>`;

describe('parseIdpMetadata', () => {
  it('extracts SSO URL and certificate', () => {
    const parsed = parseIdpMetadata(SAMPLE_METADATA);
    expect(parsed.entryPoint).toBe('https://idp.example.com/sso/saml');
    expect(parsed.certPem).toContain('BEGIN CERTIFICATE');
    expect(parsed.entityId).toBe('urn:idp:example');
  });
});

describe('buildSsoConfig', () => {
  it('marks implemented when IdP cert and URL are cached', () => {
    const config = buildSsoConfig({
      id: 'ws-1',
      slug: 'acme',
      ssoEnabled: true,
      ssoMetadataUrl: 'https://idp.example.com/metadata',
      ssoEntityId: null,
      ssoIdpSsoUrl: 'https://idp.example.com/sso/saml',
      ssoIdpCertPem: '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----',
    });

    expect(config.implemented).toBe(true);
    expect(config.loginUrl).toContain('workspace=acme');
  });
});
