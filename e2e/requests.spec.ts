import { test, expect } from '@playwright/test';
import { API_URL, fetchApiJson, login, readAccessToken } from './helpers';

test.describe('Request Explorer', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('page loads paginated requests from API', async ({ page }) => {
    await page.goto('/requests');
    const body = await fetchApiJson(page, '/analytics/requests?page=1&limit=25');

    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.pagination).toBeTruthy();

    await expect(page.getByRole('heading', { name: 'Request Explorer' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Export CSV/i })).toBeVisible();
  });

  test('export CSV triggers authenticated download request', async ({ page }) => {
    await page.goto('/requests');
    await expect(page.getByRole('heading', { name: 'Request Explorer' })).toBeVisible();

    const token = await readAccessToken(page);
    const to = new Date().toISOString();
    const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const exportResponse = await page.request.get(
      `${API_URL}/api/v1/analytics/export?format=csv&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(exportResponse.ok()).toBeTruthy();
    expect(exportResponse.headers()['content-type']).toContain('text/csv');
    const csv = await exportResponse.text();
    expect(csv).toContain('traceId,createdAt,requestedModel');
  });
});
