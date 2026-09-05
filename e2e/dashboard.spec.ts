import { test, expect } from '@playwright/test';
import { fetchApiJson, login } from './helpers';

test.describe('Authenticated dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('dashboard loads primary stats', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    const body = await fetchApiJson(page, '/analytics/overview');
    expect(body.success).toBe(true);

    await expect(page.getByText('Total Requests')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Cache Hit Rate')).toBeVisible();
  });

  test('settings page shows billing section', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.getByText('Billing & Plans')).toBeVisible();
  });

  test('reliability page loads', async ({ page }) => {
    await page.goto('/reliability');
    await expect(page.getByRole('heading', { name: 'Reliability' })).toBeVisible();
    await expect(page.getByText('Fallback Rate')).toBeVisible();
  });

  test('team page loads', async ({ page }) => {
    await page.goto('/team');
    await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Invite member/i })).toBeVisible();
  });

  test('settings shows MFA, sessions, privacy, and leave workspace', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByText('Two-factor authentication')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Active sessions' })).toBeVisible();
    await expect(page.getByText('Data & privacy')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Leave workspace' })).toBeVisible();
  });

  test('audit log page loads with export', async ({ page }) => {
    await page.goto('/audit-log');
    await expect(page.getByRole('heading', { name: 'Audit Log' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Export CSV/i })).toBeVisible();
  });
});
