import { test, expect } from '@playwright/test';
import { API_URL } from './helpers';

test.describe('OAuth callback', () => {
  test('callback page completes sign-in with tokens in query string', async ({ page }) => {
    const stamp = Date.now();
    const email = `e2e-oauth-cb-${stamp}@example.com`;
    const password = 'password123';

    await page.goto('/register');
    await page.getByLabel(/^Full name$/i).fill('OAuth Callback User');
    await page.getByLabel(/^Email$/i).fill(email);
    await page.getByLabel(/^Password$/i).fill(password);
    await page.getByRole('button', { name: /Create account/i }).click();
    await page.waitForURL('**/dashboard', { timeout: 15_000 });

    const tokens = await page.evaluate(() => {
      const raw = localStorage.getItem('smartroute-auth');
      if (!raw) return null;
      const parsed = JSON.parse(raw) as {
        state?: { accessToken?: string; refreshToken?: string };
      };
      return {
        accessToken: parsed.state?.accessToken ?? null,
        refreshToken: parsed.state?.refreshToken ?? null,
      };
    });

    expect(tokens?.accessToken).toBeTruthy();
    expect(tokens?.refreshToken).toBeTruthy();

    await page.evaluate(() => localStorage.removeItem('smartroute-auth'));
    await page.goto(
      `/oauth/callback?accessToken=${encodeURIComponent(tokens!.accessToken!)}&refreshToken=${encodeURIComponent(tokens!.refreshToken!)}`,
    );
    await page.waitForURL('**/dashboard', { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('callback redirects to login when tokens are missing', async ({ page }) => {
    await page.goto('/oauth/callback');
    await page.waitForURL('**/login?error=oauth_failed', { timeout: 10_000 });
  });

  test('Google sign-in completes via E2E OAuth bypass', async ({ page }) => {
    const stamp = Date.now();
    const email = `e2e-google-oauth-${stamp}@example.com`;
    const code = encodeURIComponent(`e2e-test-oauth:${email}|Google E2E User`);

    await page.goto(`${API_URL}/api/v1/auth/oauth/google/callback?code=${code}`);
    await page.waitForURL('**/dashboard', { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });
});
