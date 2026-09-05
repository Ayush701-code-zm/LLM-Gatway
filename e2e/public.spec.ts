import { test, expect } from '@playwright/test';

test.describe('Public pages', () => {
  test('landing page renders hero and CTAs', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /One API/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Start for free/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Sign in/i }).first()).toBeVisible();
  });

  test('login page renders form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible();
    await expect(page.getByLabel(/Email address/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Sign in/i })).toBeVisible();
  });

  test('privacy, terms, DPA, and subprocessors pages load', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { name: /Privacy Policy/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Data Processing Agreement/i })).toBeVisible();

    await page.goto('/terms');
    await expect(page.getByRole('heading', { name: /Terms of Service/i })).toBeVisible();

    await page.goto('/dpa');
    await expect(page.getByRole('heading', { name: /Data Processing Agreement/i })).toBeVisible();

    await page.goto('/subprocessors');
    await expect(page.getByRole('heading', { name: /Subprocessor List/i })).toBeVisible();
  });
});
