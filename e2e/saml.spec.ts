import { test, expect } from '@playwright/test';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

test.describe('SAML SSO flow', () => {
  test('ACS redirect completes SSO sign-in via callback', async ({ page }) => {
    const stamp = Date.now();
    const email = `e2e-saml-${stamp}@example.com`;

    const acsRes = await page.request.post(
      `${API_URL}/api/v1/auth/saml/acs?workspace=acme-enterprise`,
      {
        form: { SAMLResponse: `e2e-test-assertion:${email}|SAML E2E User` },
        maxRedirects: 0,
      },
    );

    expect(acsRes.status()).toBe(302);
    const location = acsRes.headers()['location'];
    expect(location).toContain('/saml/callback');
    expect(location).toContain('accessToken=');
    expect(location).toContain('refreshToken=');

    await page.goto(location!);
    await page.waitForURL('**/dashboard', { timeout: 15_000 });
    await expect(page.getByTestId('workspace-switcher')).toContainText('Acme Enterprise', { timeout: 15_000 });
    await expect(page.getByTestId('workspace-switcher')).toContainText('@acme-enterprise');
  });
});
