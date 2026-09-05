import { test, expect } from '@playwright/test';
import { API_URL, login, readAccessToken } from './helpers';

test.describe('Audit log', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('page loads audit entries from API', async ({ page }) => {
    const listPromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/v1/workspaces/current/audit-logs') &&
        !resp.url().includes('/export') &&
        resp.request().method() === 'GET' &&
        resp.status() === 200,
    ).then((resp) => resp.json());

    await page.goto('/audit-log');
    const body = await listPromise;

    expect(body.success).toBe(true);
    expect(Array.isArray(body.data.data)).toBe(true);
    expect(body.data.pagination).toMatchObject({
      page: expect.any(Number),
      total: expect.any(Number),
    });

    await expect(page.getByRole('heading', { name: 'Audit Log' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Export CSV/i })).toBeVisible();
  });

  test('export CSV triggers authenticated download request', async ({ page }) => {
    await page.goto('/audit-log');
    await expect(page.getByRole('heading', { name: 'Audit Log' })).toBeVisible();

    const token = await readAccessToken(page);
    const to = new Date().toISOString();
    const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const exportResponse = await page.request.get(
      `${API_URL}/api/v1/workspaces/current/audit-logs/export?format=csv&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(exportResponse.ok()).toBeTruthy();
    expect(exportResponse.headers()['content-type']).toContain('text/csv');
    const csv = await exportResponse.text();
    expect(csv).toContain('id,action,resourceType');
  });
});
