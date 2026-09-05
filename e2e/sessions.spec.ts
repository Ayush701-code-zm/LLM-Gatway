import { test, expect } from '@playwright/test';
import { fetchApiJson, login } from './helpers';

test.describe('Active sessions', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('settings loads sessions from API', async ({ page }) => {
    await page.goto('/settings');
    const body = await fetchApiJson<unknown[]>(page, '/auth/sessions');

    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);

    await expect(page.getByTestId('sessions-section')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('sessions-section').getByText('current')).toBeVisible();
  });
});
