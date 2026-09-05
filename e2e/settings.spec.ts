import { test, expect } from '@playwright/test';
import { API_URL, login, readAccessToken } from './helpers';

test.describe('Settings validation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('shows inline error for reserved slug without API call', async ({ page }) => {
    let patchCalled = false;
    await page.route('**/api/v1/workspaces/current', (route) => {
      if (route.request().method() === 'PATCH') patchCalled = true;
      route.continue();
    });

    await page.goto('/settings');
    await page.getByLabel(/^Workspace slug$/i).fill('admin');
    await page.getByRole('button', { name: /Save settings/i }).click();

    await expect(page.getByText(/Slug is reserved/i)).toBeVisible({ timeout: 5_000 });
    expect(patchCalled).toBe(false);
  });

  test('export my data triggers authenticated JSON download', async ({ page }) => {
    await page.goto('/settings');
    const token = await readAccessToken(page);

    const exportResponse = await page.request.get(`${API_URL}/api/v1/auth/me/export`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(exportResponse.ok()).toBeTruthy();
    expect(exportResponse.headers()['content-type']).toContain('application/json');
    const body = await exportResponse.json();
    expect(body.user.email).toBe(process.env.E2E_EMAIL ?? 'admin@smartroute.dev');
    expect(Array.isArray(body.workspaces)).toBe(true);
    expect(body.exportedAt).toBeTruthy();
  });
});
