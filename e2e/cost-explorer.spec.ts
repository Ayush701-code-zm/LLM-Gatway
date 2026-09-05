import { test, expect } from '@playwright/test';
import { fetchApiJson, login } from './helpers';

test.describe('Cost explorer', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('page loads spend breakdown from analytics API', async ({ page }) => {
    await page.goto('/cost-explorer');

    const [dailyBody, overviewBody] = await Promise.all([
      fetchApiJson(page, '/analytics/spend/daily?days=30'),
      fetchApiJson(page, '/analytics/overview'),
    ]);

    expect(dailyBody.success).toBe(true);
    expect(Array.isArray(dailyBody.data)).toBe(true);

    expect(overviewBody.success).toBe(true);

    await expect(page.getByRole('heading', { name: 'Cost Explorer' })).toBeVisible();
    await expect(page.getByText('Baseline Cost').first()).toBeVisible();
    await expect(page.getByText('Cost Comparison (30 days)')).toBeVisible();
  });
});
