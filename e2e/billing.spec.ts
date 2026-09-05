import { test, expect } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL ?? 'admin@smartroute.dev';
const PASSWORD = process.env.E2E_PASSWORD ?? 'admin123';

test.describe('Billing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/Email address/i).fill(EMAIL);
    await page.getByLabel(/^Password/i).fill(PASSWORD);
    await page.getByRole('button', { name: /^Sign in$/i }).click();
    await page.waitForURL('**/dashboard', { timeout: 15_000 });
  });

  test('settings shows plan cards', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByText('Billing & Plans')).toBeVisible();
    await expect(page.getByText('free plan')).toBeVisible();
    await expect(page.getByText('$49/mo')).toBeVisible();
    await expect(page.getByText('$499')).toBeVisible();
  });

  test('shows Stripe setup notice when billing is not configured', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByTestId('billing-stripe-not-configured')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('billing-upgrade-pro')).not.toBeVisible();
  });

  test('shows checkout success notice from return URL', async ({ page }) => {
    await page.goto('/settings?billing=success');
    await expect(page.getByTestId('billing-success-notice')).toBeVisible({ timeout: 10_000 });
  });

  test('upgrade button redirects to Stripe Checkout when configured', async ({ page }) => {
    await page.route('**/api/v1/billing/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { currentPlan: 'FREE', stripeConfigured: true, hasBillingAccount: false },
        }),
      });
    });

    await page.route('**/api/v1/billing/checkout', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { url: 'https://checkout.stripe.com/c/pay/e2e-test-session', sessionId: 'cs_e2e_test' },
        }),
      });
    });

    await page.goto('/settings');
    await expect(page.getByTestId('billing-upgrade-pro')).toBeVisible({ timeout: 10_000 });

    await Promise.all([
      page.waitForURL(/checkout\.stripe\.com/),
      page.getByTestId('billing-upgrade-pro').click(),
    ]);
  });

  test('manage subscription redirects to Stripe portal when configured', async ({ page }) => {
    await page.route('**/api/v1/billing/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { currentPlan: 'PRO', stripeConfigured: true, hasBillingAccount: true },
        }),
      });
    });

    await page.route('**/api/v1/billing/portal', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { url: 'https://billing.stripe.com/p/session/e2e-test-portal' },
        }),
      });
    });

    await page.goto('/settings');
    await expect(page.getByTestId('billing-manage-subscription')).toBeVisible({ timeout: 10_000 });

    await Promise.all([
      page.waitForURL(/billing\.stripe\.com/),
      page.getByTestId('billing-manage-subscription').click(),
    ]);
  });
});
