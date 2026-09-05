import { test, expect } from '@playwright/test';
import { login, switchWorkspace } from './helpers';

test.describe('Workspace switcher', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('admin switches between seeded workspaces', async ({ page }) => {
    await switchWorkspace(page, 'acme-enterprise');
    await expect(page.getByTestId('workspace-switcher')).toContainText('Acme Enterprise');
    await expect(page.getByTestId('workspace-switcher')).toContainText('@acme-enterprise');

    await page.goto('/settings');
    await expect(page.getByRole('main').getByText('Enterprise', { exact: true }).first()).toBeVisible();

    await switchWorkspace(page, 'smartroute-dev');
    await expect(page.getByTestId('workspace-switcher')).toContainText('SmartRoute Dev');
  });
});
