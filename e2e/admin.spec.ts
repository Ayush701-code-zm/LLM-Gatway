import { test, expect } from '@playwright/test';
import { fetchApiJson, login } from './helpers';

const ADMIN_EMAIL = process.env.E2E_EMAIL ?? 'admin@smartroute.dev';
const ADMIN_PASSWORD = process.env.E2E_PASSWORD ?? 'admin123';

async function findAdminWorkspace(
  page: Parameters<typeof fetchApiJson>[0],
  slug: string,
): Promise<{ id: string; plan: string }> {
  for (let pageNum = 1; pageNum <= 10; pageNum++) {
    const body = await fetchApiJson<Array<{ id: string; slug: string; plan: string }>>(
      page,
      `/admin/workspaces?page=${pageNum}&limit=50`,
    );

    const match = body.data.find((ws) => ws.slug === slug);
    if (match) return match;
    if (!body.pagination?.hasNext) break;
  }
  throw new Error(`Workspace ${slug} not found in admin list`);
}

test.describe('Platform admin', () => {
  test('super-admin sees admin panel and can cycle workspace plan', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    const target = await findAdminWorkspace(page, 'smartroute-dev');
    const nextPlan = target.plan === 'FREE' ? 'PRO' : target.plan === 'PRO' ? 'ENTERPRISE' : 'FREE';

    await fetchApiJson(page, `/admin/workspaces/${target.id}`, {
      method: 'PATCH',
      data: { plan: nextPlan },
    });

    await page.goto('/admin');
    await expect(page.getByTestId('admin-page-title')).toBeVisible();
    await expect(page.getByTestId('admin-tab-users')).toBeVisible();
    await expect(page.getByText('Workspaces', { exact: true })).toBeVisible();

    const cycleBtn = page.getByTestId('admin-cycle-plan-smartroute-dev');
    if (await cycleBtn.count()) {
      await expect(cycleBtn).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole('row', { name: /smartroute-dev/ })).toContainText(nextPlan, { timeout: 10_000 });
    } else {
      const updated = await findAdminWorkspace(page, 'smartroute-dev');
      expect(updated.plan).toBe(nextPlan);
    }

    await page.getByTestId('admin-tab-users').click();
    await expect(page.getByText(ADMIN_EMAIL)).toBeVisible({ timeout: 10_000 });
  });

  test('regular user cannot access admin panel', async ({ page }) => {
    const stamp = Date.now();
    const email = `e2e-no-admin-${stamp}@example.com`;

    await page.goto('/register');
    await page.getByLabel(/^Full name$/i).fill('Regular User');
    await page.getByLabel(/^Email$/i).fill(email);
    await page.getByLabel(/^Password$/i).fill('password123');
    await page.getByRole('button', { name: /Create account/i }).click();
    await page.waitForURL('**/dashboard', { timeout: 15_000 });

    await expect(page.getByTestId('nav-admin')).not.toBeVisible();
    await page.goto('/admin');
    await expect(page.getByTestId('admin-access-denied')).toBeVisible({ timeout: 10_000 });
  });
});
