import { test, expect } from '@playwright/test';
import { fetchApiJson, login, waitForUnreadCount } from './helpers';

test.describe('Notifications', () => {
  test('mark read clears header badge after slug change', async ({ page }) => {
    const stamp = Date.now();
    const email = `e2e-notify-${stamp}@example.com`;
    const password = 'password123';
    const initialSlug = `e2e-n-${stamp}`.slice(0, 40);
    const updatedSlug = `e2e-nu-${stamp}`.slice(0, 40);

    await page.goto('/register');
    await page.getByLabel(/^Full name$/i).fill('Notify E2E User');
    await page.getByLabel(/^Email$/i).fill(email);
    await page.getByLabel(/^Password$/i).fill(password);
    await page.getByLabel(/^Workspace slug$/i).fill(initialSlug);
    await page.getByRole('button', { name: /Create account/i }).click();
    await page.waitForURL('**/dashboard', { timeout: 15_000 });

    await page.goto('/settings');
    await page.getByLabel(/^Workspace slug$/i).fill(updatedSlug);
    await page.getByRole('button', { name: /Save settings/i }).click();
    await expect(page.getByText(/Settings saved successfully/i)).toBeVisible({ timeout: 10_000 });
    await waitForUnreadCount(page, 1);
    await expect(page.getByTestId('notification-badge')).toHaveText('1', { timeout: 10_000 });

    await page.goto('/notifications');
    await expect(page.getByText('Workspace slug updated')).toBeVisible({ timeout: 10_000 });
    await page.getByTitle('Mark as read').first().click();

    await expect(page.getByTestId('notification-badge')).not.toBeVisible({ timeout: 10_000 });
  });

  test('mark all read clears header badge', async ({ page }) => {
    const stamp = Date.now();
    const email = `e2e-notify-all-${stamp}@example.com`;
    const password = 'password123';
    const initialSlug = `e2e-na-${stamp}`.slice(0, 40);
    const updatedSlug = `e2e-nau-${stamp}`.slice(0, 40);

    await page.goto('/register');
    await page.getByLabel(/^Full name$/i).fill('Notify All E2E User');
    await page.getByLabel(/^Email$/i).fill(email);
    await page.getByLabel(/^Password$/i).fill(password);
    await page.getByLabel(/^Workspace slug$/i).fill(initialSlug);
    await page.getByRole('button', { name: /Create account/i }).click();
    await page.waitForURL('**/dashboard', { timeout: 15_000 });

    await page.goto('/settings');
    await page.getByLabel(/^Workspace slug$/i).fill(updatedSlug);
    await page.getByRole('button', { name: /Save settings/i }).click();
    await waitForUnreadCount(page, 1);
    await expect(page.getByTestId('notification-badge')).toHaveText('1', { timeout: 10_000 });

    await page.goto('/notifications');
    await page.getByTestId('notifications-mark-all-read').click();

    await expect(page.getByTestId('notification-badge')).not.toBeVisible({ timeout: 10_000 });
  });

  test('unread filter hides read notifications', async ({ page }) => {
    const stamp = Date.now();
    const email = `e2e-unread-filter-${stamp}@example.com`;
    const password = 'password123';
    const initialSlug = `e2e-uf-${stamp}`.slice(0, 40);
    const updatedSlug = `e2e-ufu-${stamp}`.slice(0, 40);

    await page.goto('/register');
    await page.getByLabel(/^Full name$/i).fill('Unread Filter User');
    await page.getByLabel(/^Email$/i).fill(email);
    await page.getByLabel(/^Password$/i).fill(password);
    await page.getByLabel(/^Workspace slug$/i).fill(initialSlug);
    await page.getByRole('button', { name: /Create account/i }).click();
    await page.waitForURL('**/dashboard', { timeout: 15_000 });

    await page.goto('/settings');
    await page.getByLabel(/^Workspace slug$/i).fill(updatedSlug);
    await page.getByRole('button', { name: /Save settings/i }).click();
    await expect(page.getByText(/Settings saved successfully/i)).toBeVisible({ timeout: 10_000 });
    await waitForUnreadCount(page, 1);
    await expect(page.getByTestId('notification-badge')).toHaveText('1', { timeout: 10_000 });

    await page.goto('/notifications');
    await expect(page.getByText('Workspace slug updated')).toBeVisible({ timeout: 10_000 });
    await page.getByTitle('Mark as read').first().click();
    await waitForUnreadCount(page, 0);
    await expect(page.getByTestId('notification-badge')).not.toBeVisible({ timeout: 10_000 });

    await page.getByTestId('notifications-unread-filter').click();
    await expect(page.getByText('Showing unread')).toBeVisible({ timeout: 5_000 });
    await expect
      .poll(async () => {
        const body = await fetchApiJson<{ data: unknown[] }>(
          page,
          '/notifications?page=1&limit=30&unread=true',
        );
        return body.data.data.length;
      })
      .toBe(0);
    await expect(page.getByText('No unread notifications')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('notifications-unread-filter').click();
    await expect(page.getByText('Workspace slug updated')).toBeVisible({ timeout: 10_000 });
  });

  test('admin notifications page loads list and unread count from API', async ({ page }) => {
    const EMAIL = process.env.E2E_EMAIL ?? 'admin@smartroute.dev';
    const PASSWORD = process.env.E2E_PASSWORD ?? 'admin123';

    await login(page);

    const [listBody, unreadBody] = await Promise.all([
      fetchApiJson<{ data: unknown[]; pagination: Record<string, unknown> }>(page, '/notifications'),
      fetchApiJson<{ count: number }>(page, '/notifications/unread-count'),
    ]);

    await page.goto('/notifications');

    expect(listBody.success).toBe(true);
    expect(Array.isArray(listBody.data.data)).toBe(true);
    expect(listBody.data.pagination).toBeTruthy();

    expect(unreadBody.success).toBe(true);
    expect(typeof unreadBody.data.count).toBe('number');

    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
    await expect(page.getByTestId('notifications-unread-filter')).toBeVisible();
  });
});
