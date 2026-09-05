import { test, expect } from '@playwright/test';

test.describe('Login SSO discovery', () => {
  test('typing workspace slug triggers SAML discover (SSO hidden on free plan)', async ({ page }) => {
    await page.goto('/login');

    const discoverPromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/auth/saml/discover') &&
        resp.request().method() === 'GET' &&
        resp.status() === 200,
    );

    await page.getByLabel(/Workspace slug/i).fill('smartroute-dev');

    const discoverResponse = await discoverPromise;
    const body = await discoverResponse.json();
    expect(body.data.enabled).toBe(false);

    await expect(page.getByRole('link', { name: /Sign in with SSO/i })).not.toBeVisible();
  });

  test('registered slug is discoverable from login page', async ({ page }) => {
    const stamp = Date.now();
    const email = `e2e-login-discover-${stamp}@example.com`;
    const slug = `e2e-disc-${stamp}`.slice(0, 40);

    await page.goto('/register');
    await page.getByLabel(/^Full name$/i).fill('Discover Test');
    await page.getByLabel(/^Email$/i).fill(email);
    await page.getByLabel(/^Password$/i).fill('password123');
    await page.getByLabel(/^Workspace slug$/i).fill(slug);
    await page.getByRole('button', { name: /Create account/i }).click();
    await page.waitForURL('**/dashboard', { timeout: 15_000 });

    await page.evaluate(() => localStorage.removeItem('smartroute-auth'));
    await page.goto('/login');

    const discoverPromise = page.waitForResponse(
      (resp) =>
        resp.url().includes(`/auth/saml/discover`) &&
        resp.url().includes(encodeURIComponent(slug)) &&
        resp.status() === 200,
    );

    await page.getByLabel(/Workspace slug/i).fill(slug);
    const discoverResponse = await discoverPromise;
    const body = await discoverResponse.json();
    expect(body.success).toBe(true);
    expect(body.data.enabled).toBe(false);
  });

  test('enterprise workspace shows SSO sign-in on login page', async ({ page }) => {
    await page.goto('/login');

    const discoverPromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/auth/saml/discover') &&
        resp.url().includes('acme-enterprise') &&
        resp.status() === 200,
    );

    await page.getByLabel(/Workspace slug/i).fill('acme-enterprise');

    const discoverResponse = await discoverPromise;
    const body = await discoverResponse.json();
    expect(body.data.enabled).toBe(true);
    expect(body.data.loginUrl).toBeTruthy();

    await expect(page.getByTestId('sso-sign-in-link')).toBeVisible();
  });

  test('clicking SSO link completes enterprise sign-in', async ({ page }) => {
    const stamp = Date.now();
    const email = `e2e-sso-click-${stamp}@example.com`;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

    await page.route('**/api/v1/auth/saml/login?workspace=acme-enterprise', async (route) => {
      const acsRes = await fetch(
        `${apiUrl}/api/v1/auth/saml/acs?workspace=acme-enterprise`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            SAMLResponse: `e2e-test-assertion:${email}|SSO Click User`,
          }),
          redirect: 'manual',
        },
      );
      const location = acsRes.headers.get('location');
      if (!location || acsRes.status !== 302) {
        await route.fulfill({ status: 502, body: 'ACS mock failed' });
        return;
      }
      await route.fulfill({ status: 302, headers: { Location: location } });
    });

    await page.goto('/login');
    await page.getByLabel(/Workspace slug/i).fill('acme-enterprise');
    await expect(page.getByTestId('sso-sign-in-link')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('sso-sign-in-link').click();
    await page.waitForURL('**/dashboard', { timeout: 15_000 });
    await expect(page.getByTestId('workspace-switcher')).toContainText('@acme-enterprise');
  });
});
