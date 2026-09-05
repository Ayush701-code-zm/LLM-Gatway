import { test, expect } from '@playwright/test';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

test.describe('Registration', () => {
  test('rejects reserved workspace slug', async ({ page }) => {
    const stamp = Date.now();

    await page.goto('/register');
    await page.getByLabel(/^Full name$/i).fill('Reserved Slug Test');
    await page.getByLabel(/^Email$/i).fill(`e2e-reserved-${stamp}@example.com`);
    await page.getByLabel(/^Password$/i).fill('password123');
    await page.getByLabel(/^Workspace slug$/i).fill('admin');
    await page.getByRole('button', { name: /Create account/i }).click();
    await expect(page.getByText(/Slug is reserved/i)).toBeVisible({ timeout: 10_000 });
  });

  test('registers with custom workspace slug and edits slug in settings', async ({ page }) => {
    const stamp = Date.now();
    const email = `e2e-register-${stamp}@example.com`;
    const password = 'password123';
    const initialSlug = `e2e-co-${stamp}`.slice(0, 40);
    const updatedSlug = `e2e-upd-${stamp}`.slice(0, 40);

    await page.goto('/register');
    await page.getByLabel(/^Full name$/i).fill('E2E Register User');
    await page.getByLabel(/^Email$/i).fill(email);
    await page.getByLabel(/^Password$/i).fill(password);
    await page.getByLabel(/^Workspace name$/i).fill('E2E Test Co');
    await page.getByLabel(/^Workspace slug$/i).fill(initialSlug);
    await page.getByRole('button', { name: /Create account/i }).click();
    await page.waitForURL('**/dashboard', { timeout: 15_000 });

    await page.goto('/settings');
    await expect(page.getByRole('main').getByText(`@${initialSlug}`)).toBeVisible();

    await page.getByLabel(/^Workspace slug$/i).fill(updatedSlug);
    await page.getByRole('button', { name: /Save settings/i }).click();
    await expect(page.getByText(/Settings saved successfully/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel(/^Workspace slug$/i)).toHaveValue(updatedSlug);

    await expect(page.getByTestId('notification-badge')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('notification-badge')).toHaveText('1');

    await page.goto('/notifications');
    await expect(page.getByText('Workspace slug updated')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(new RegExp(`@${initialSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))).toBeVisible();
    await expect(page.getByText(new RegExp(`@${updatedSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)).first()).toBeVisible();

    await page.goto('/audit-log');
    await expect(
      page.getByText(new RegExp(`@${initialSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*→\\s*@${updatedSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)),
    ).toBeVisible({ timeout: 10_000 });

    const token = await page.evaluate(() => {
      const raw = localStorage.getItem('smartroute-auth');
      if (!raw) return null;
      return (JSON.parse(raw) as { state?: { accessToken?: string } }).state?.accessToken ?? null;
    });

    const discoverRes = await page.request.get(
      `${API_URL}/api/v1/auth/saml/discover?workspace=${encodeURIComponent(updatedSlug)}`,
    );
    expect(discoverRes.ok()).toBeTruthy();
    expect(token).toBeTruthy();
  });
});
