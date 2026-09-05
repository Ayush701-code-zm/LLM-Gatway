import { test, expect } from '@playwright/test';
import { generateSync } from 'otplib';

test.describe('MFA', () => {
  test('enable MFA and complete login with TOTP', async ({ page }) => {
    const stamp = Date.now();
    const email = `e2e-mfa-${stamp}@example.com`;
    const password = 'password123';

    await page.goto('/register');
    await page.getByLabel(/^Full name$/i).fill('MFA E2E User');
    await page.getByLabel(/^Email$/i).fill(email);
    await page.getByLabel(/^Password$/i).fill(password);
    await page.getByRole('button', { name: /Create account/i }).click();
    await page.waitForURL('**/dashboard', { timeout: 15_000 });

    await page.goto('/settings');
    await expect(page.getByText('Two-factor authentication')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('mfa-status-badge')).toHaveText('Disabled', { timeout: 15_000 });
    await page.getByTestId('mfa-enable-button').click();
    await expect(page.getByTestId('mfa-setup-secret')).toBeVisible({ timeout: 10_000 });

    const secret = await page.getByTestId('mfa-setup-secret').textContent();
    expect(secret).toBeTruthy();
    const code = generateSync({ secret: secret!.trim() });

    await page.getByTestId('mfa-confirm-code').fill(code);
    await page.getByTestId('mfa-confirm-button').click();
    await expect(page.getByText(/Save these backup codes/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('mfa-status-badge')).toHaveText('Enabled', { timeout: 10_000 });

    await page.evaluate(() => localStorage.removeItem('smartroute-auth'));
    await page.goto('/login');
    await page.getByLabel(/Email address/i).fill(email);
    await page.getByLabel(/^Password/i).fill(password);
    await page.getByRole('button', { name: /^Sign in$/i }).click();

    await expect(page.getByText(/Two-factor authentication/i)).toBeVisible({ timeout: 10_000 });
    const loginCode = generateSync({ secret: secret!.trim() });
    await page.getByPlaceholder(/6-digit code/i).fill(loginCode);
    await page.getByRole('button', { name: /^Verify$/i }).click();
    await page.waitForURL('**/dashboard', { timeout: 15_000 });
  });
});
