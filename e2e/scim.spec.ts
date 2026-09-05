import { test, expect } from '@playwright/test';
import { API_URL, login, switchWorkspace } from './helpers';

test.describe('SCIM provisioning', () => {
  test('enterprise workspace provisions member via SCIM API', async ({ page }) => {
    const stamp = Date.now();
    const scimEmail = `e2e-scim-${stamp}@example.com`;

    await login(page);
    await switchWorkspace(page, 'acme-enterprise');

    const accessToken = await page.evaluate(() => {
      const raw = localStorage.getItem('smartroute-auth');
      if (!raw) return null;
      return (JSON.parse(raw) as { state?: { accessToken?: string } }).state?.accessToken ?? null;
    });
    expect(accessToken).toBeTruthy();

    const scimConfigRes = await page.request.patch(`${API_URL}/api/v1/workspaces/current/scim`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { enabled: true, regenerateToken: true },
    });
    expect(scimConfigRes.ok()).toBeTruthy();
    const scimConfig = await scimConfigRes.json();
    expect(scimConfig.data.token).toMatch(/^sr_scim_/);

    const provisionRes = await page.request.post(`${API_URL}/scim/v2/Users`, {
      headers: { Authorization: `Bearer ${scimConfig.data.token}` },
      data: {
        userName: scimEmail,
        name: { formatted: 'SCIM E2E User' },
        emails: [{ value: scimEmail, primary: true }],
      },
    });
    expect(provisionRes.status()).toBe(201);
    const provisionBody = await provisionRes.json();
    expect(provisionBody.userName).toBe(scimEmail);

    await page.goto('/team');
    await expect(page.getByText(scimEmail)).toBeVisible({ timeout: 10_000 });
  });
});
