import { test, expect } from '@playwright/test';
import { fetchApiJson, login } from './helpers';

test.describe('Analytics', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('page loads overview, daily spend, and usage metrics from API', async ({ page }) => {
    await page.goto('/analytics');

    const [overviewBody, dailyBody, usageBody] = await Promise.all([
      fetchApiJson<{ totalRequests: number }>(page, '/analytics/overview'),
      fetchApiJson<unknown[]>(page, '/analytics/spend/daily?days=30'),
      fetchApiJson<{ series: unknown[] }>(page, '/analytics/usage?days=30'),
    ]);

    expect(overviewBody.success).toBe(true);
    expect(typeof overviewBody.data.totalRequests).toBe('number');

    expect(dailyBody.success).toBe(true);
    expect(Array.isArray(dailyBody.data)).toBe(true);

    expect(usageBody.success).toBe(true);
    expect(Array.isArray(usageBody.data.series)).toBe(true);

    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();
    await expect(page.getByText('Total Requests')).toBeVisible();
    await expect(page.getByText('Cost vs Savings — Last 30 Days')).toBeVisible();
    await expect(page.getByText('Usage Metrics — Last 30 Days')).toBeVisible();
  });
});
