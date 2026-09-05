import { test, expect } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL ?? 'admin@smartroute.dev';
const PASSWORD = process.env.E2E_PASSWORD ?? 'admin123';

test.describe('Team', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/Email address/i).fill(EMAIL);
    await page.getByLabel(/^Password/i).fill(PASSWORD);
    await page.getByRole('button', { name: /^Sign in$/i }).click();
    await page.waitForURL('**/dashboard', { timeout: 15_000 });
  });

  test('page loads members and pending invites from API', async ({ page }) => {
    const membersPromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/workspaces/current/members') &&
        !resp.url().includes('/invite') &&
        resp.request().method() === 'GET' &&
        resp.status() === 200,
    );
    const invitesPromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/workspaces/current/members/invites') &&
        resp.request().method() === 'GET' &&
        resp.status() === 200,
    );

    await page.goto('/team');

    const membersResponse = await membersPromise;
    const membersBody = await membersResponse.json();
    expect(membersBody.success).toBe(true);
    expect(Array.isArray(membersBody.data)).toBe(true);
    expect(membersBody.data.length).toBeGreaterThan(0);

    const invitesResponse = await invitesPromise;
    const invitesBody = await invitesResponse.json();
    expect(invitesBody.success).toBe(true);
    expect(Array.isArray(invitesBody.data)).toBe(true);

    await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Invite member/i })).toBeVisible();
    await expect(page.getByText(EMAIL)).toBeVisible();
  });
});
