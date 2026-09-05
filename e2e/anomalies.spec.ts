import { test, expect } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL ?? 'admin@smartroute.dev';
const PASSWORD = process.env.E2E_PASSWORD ?? 'admin123';

test.describe('Anomalies', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/Email address/i).fill(EMAIL);
    await page.getByLabel(/^Password/i).fill(PASSWORD);
    await page.getByRole('button', { name: /^Sign in$/i }).click();
    await page.waitForURL('**/dashboard', { timeout: 15_000 });
  });

  test('page loads anomaly alerts from API', async ({ page }) => {
    const anomaliesPromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/analytics/anomalies') &&
        resp.request().method() === 'GET' &&
        resp.status() === 200,
    );

    await page.goto('/anomalies');
    const anomaliesResponse = await anomaliesPromise;
    const body = await anomaliesResponse.json();

    expect(body.success).toBe(true);
    expect(typeof body.data.count).toBe('number');
    expect(Array.isArray(body.data.anomalies)).toBe(true);

    await expect(page.getByRole('heading', { name: 'Anomalies' })).toBeVisible();
    await expect(
      page.getByText(/No anomalies detected|anomaly detected/i),
    ).toBeVisible();
  });
});
