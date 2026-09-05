import { test, expect } from '@playwright/test';
import { fetchApiJson, login } from './helpers';

test.describe('Model registry', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('page loads model list from API', async ({ page }) => {
    await page.goto('/models');
    const body = await fetchApiJson<Array<{ provider: string }>>(page, '/models');

    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);

    await expect(page.getByRole('heading', { name: 'Model Registry' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Input $/M' }).first()).toBeVisible();
    await expect(page.getByText(body.data[0].provider).first()).toBeVisible();
  });
});
