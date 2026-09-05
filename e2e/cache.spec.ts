import { test, expect } from '@playwright/test';
import { fetchApiJson, login } from './helpers';

test.describe('Semantic cache', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('page loads cache stats from analytics overview', async ({ page }) => {
    await page.goto('/cache');
    const body = await fetchApiJson<{ cacheHitRate: string }>(page, '/analytics/overview');

    expect(body.success).toBe(true);
    expect(typeof body.data.cacheHitRate).toBe('string');

    await expect(page.getByRole('heading', { name: 'Semantic Cache', exact: true })).toBeVisible();
    await expect(page.getByText('How Semantic Cache Works')).toBeVisible();
  });
});
