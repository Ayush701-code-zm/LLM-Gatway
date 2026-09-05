import { test, expect } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL ?? 'admin@smartroute.dev';
const PASSWORD = process.env.E2E_PASSWORD ?? 'admin123';

test.describe('Webhooks', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/Email address/i).fill(EMAIL);
    await page.getByLabel(/^Password/i).fill(PASSWORD);
    await page.getByRole('button', { name: /^Sign in$/i }).click();
    await page.waitForURL('**/dashboard', { timeout: 15_000 });
  });

  test('page loads webhooks from API', async ({ page }) => {
    const listPromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/v1/webhooks') &&
        resp.request().method() === 'GET' &&
        resp.status() === 200,
    );

    await page.goto('/webhooks');
    const listResponse = await listPromise;
    const body = await listResponse.json();

    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    await expect(page.getByRole('heading', { name: 'Webhooks' })).toBeVisible();
  });

  test('creates a webhook endpoint', async ({ page }) => {
    const stamp = Date.now();

    await page.goto('/webhooks');
    await page.getByTestId('webhooks-add-button').click();
    await expect(page.getByTestId('webhook-create-modal')).toBeVisible();

    await page.getByPlaceholder(/Slack Alerts/i).fill(`E2E Hook ${stamp}`);
    await page.getByPlaceholder(/your-server\.com/i).fill('http://localhost:9999/e2e-hook');
    await page.getByLabel(/Budget Warning/i).check();

    const createPromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/v1/webhooks') &&
        resp.request().method() === 'POST' &&
        resp.status() === 201,
    );

    await page.getByRole('button', { name: /Create webhook/i }).click();
    const createResponse = await createPromise;
    const body = await createResponse.json();

    expect(body.data.name).toContain(`E2E Hook ${stamp}`);
    expect(body.data.signingSecret).toMatch(/^whs_/);
    await expect(page.getByText(/Signing secret — save it now!/i)).toBeVisible();
  });
});
