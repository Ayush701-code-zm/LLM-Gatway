import { test, expect } from '@playwright/test';
import { fetchApiJson, login, switchWorkspace } from './helpers';

test.describe('API Keys', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('page loads keys from API', async ({ page }) => {
    await page.goto('/api-keys');
    const body = await fetchApiJson(page, '/api-keys');

    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    await expect(page.getByRole('heading', { name: 'API Keys' })).toBeVisible();
  });

  test('creates a new API key', async ({ page }) => {
    const stamp = Date.now();
    const keyName = `E2E Key ${stamp}`;

    await switchWorkspace(page, 'acme-enterprise');

    const workspace = await fetchApiJson<{ plan: string }>(page, '/workspaces/current');
    expect(workspace.data.plan).toBe('ENTERPRISE');

    const body = await fetchApiJson<{ name: string; rawKey: string }>(
      page,
      '/api-keys',
      { method: 'POST', data: { name: keyName } },
    );

    expect(body.data.name).toContain(keyName);
    expect(body.data.rawKey).toMatch(/^sk-/);

    await page.goto('/api-keys');
    await expect(page.getByText(keyName)).toBeVisible({ timeout: 10_000 });
  });
});
