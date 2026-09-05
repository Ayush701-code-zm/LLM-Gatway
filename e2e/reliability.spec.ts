import { test, expect } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL ?? 'admin@smartroute.dev';
const PASSWORD = process.env.E2E_PASSWORD ?? 'admin123';

test.describe('Reliability', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/Email address/i).fill(EMAIL);
    await page.getByLabel(/^Password/i).fill(PASSWORD);
    await page.getByRole('button', { name: /^Sign in$/i }).click();
    await page.waitForURL('**/dashboard', { timeout: 15_000 });
  });

  test('page loads reliability stats from API', async ({ page }) => {
    const reliabilityPromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/analytics/reliability') &&
        resp.request().method() === 'GET' &&
        resp.status() === 200,
    );

    await page.goto('/reliability');
    const reliabilityResponse = await reliabilityPromise;
    const body = await reliabilityResponse.json();

    expect(body.success).toBe(true);
    expect(typeof body.data.totalRequests).toBe('number');
    expect(typeof body.data.fallbackRate).toBe('string');
    expect(Array.isArray(body.data.fallbackByProvider)).toBe(true);

    await expect(page.getByRole('heading', { name: 'Reliability' })).toBeVisible();
    await expect(page.getByText('Fallback Rate')).toBeVisible();
    await expect(page.getByText('Retry Rate')).toBeVisible();
    await expect(page.getByText('Circuit Opens')).toBeVisible();
  });
});
