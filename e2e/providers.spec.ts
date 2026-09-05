import { test, expect } from '@playwright/test';
import { fetchApiJson, login } from './helpers';

test.describe('Provider monitoring', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('page loads provider and infra health from API', async ({ page }) => {
    await page.goto('/providers');

    const [providerBody, infraBody] = await Promise.all([
      fetchApiJson(page, '/workspaces/current/health'),
      fetchApiJson(page, '/system/health'),
    ]);

    expect(providerBody.success).toBe(true);
    expect(Array.isArray(providerBody.data)).toBe(true);

    expect(infraBody.success).toBe(true);
    expect(Array.isArray(infraBody.data)).toBe(true);

    await expect(page.getByRole('heading', { name: 'Provider Monitoring' })).toBeVisible();
    await expect(page.getByText('Total Models')).toBeVisible();
  });
});
