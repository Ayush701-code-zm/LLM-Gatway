import { test, expect } from '@playwright/test';
import { fetchApiJson, login, switchWorkspace } from './helpers';

test.describe('Invite flow', () => {
  test('admin invites via team UI; invitee registers and accepts', async ({ page }) => {
    const inviteEmail = `e2e-invite-${Date.now()}@example.com`;
    const invitePassword = 'password123';

    await login(page);
    await switchWorkspace(page, 'acme-enterprise');

    await page.goto('/team');
    await page.getByRole('button', { name: /Invite member/i }).click();
    await expect(page.getByRole('heading', { name: 'Invite team member' })).toBeVisible();

    const inviteResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/members/invite') &&
        resp.request().method() === 'POST' &&
        resp.status() === 201,
    ).then((resp) => resp.json());

    await page.getByLabel(/^Email$/i).fill(inviteEmail);
    await page.getByLabel(/^Role$/i).selectOption('MEMBER');
    await page.getByRole('button', { name: /^Send invite$/i }).click();

    const inviteBody = await inviteResponsePromise;
    const inviteToken: string = inviteBody.data.token;
    expect(inviteToken).toBeTruthy();

    await expect(page.getByText(inviteEmail)).toBeVisible({ timeout: 10_000 });

    await page.evaluate(() => localStorage.removeItem('smartroute-auth'));
    await page.goto('/register');
    await page.getByLabel(/^Full name$/i).fill('E2E Invitee');
    await page.getByLabel(/^Email$/i).fill(inviteEmail);
    await page.getByLabel(/^Password$/i).fill(invitePassword);
    await page.getByRole('button', { name: /Create account/i }).click();
    await page.waitForURL('**/dashboard', { timeout: 15_000 });
    await page.waitForFunction(() => localStorage.getItem('smartroute-auth') !== null);

    await page.goto(`/accept-invite?token=${inviteToken}`);
    await page.waitForURL('**/team', { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible();
    await expect(page.getByTestId('workspace-switcher')).toContainText('@acme-enterprise');
  });
});
