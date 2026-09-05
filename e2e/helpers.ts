import { expect, type Page, type Response } from '@playwright/test';

export const DEFAULT_EMAIL = process.env.E2E_EMAIL ?? 'admin@smartroute.dev';
export const DEFAULT_PASSWORD = process.env.E2E_PASSWORD ?? 'admin123';
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface ApiJsonBody<T = unknown> {
  success: boolean;
  data: T;
  pagination?: Record<string, unknown>;
}

export function isApiResponse(
  resp: Response,
  pathFragment: string,
  method: string,
  status = 200,
): boolean {
  const url = resp.url();
  return (
    url.includes('/api/v1/') &&
    url.includes(pathFragment) &&
    resp.request().method() === method &&
    resp.status() === status
  );
}

export async function readAccessToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('smartroute-auth');
    if (!raw) return null;
    return (JSON.parse(raw) as { state?: { accessToken?: string } }).state?.accessToken ?? null;
  });
  if (!token) throw new Error('Missing access token in localStorage');
  return token;
}

export async function fetchApiJson<T = unknown>(
  page: Page,
  path: string,
  init: { method?: string; data?: unknown } = {},
): Promise<ApiJsonBody<T>> {
  const token = await readAccessToken(page);
  const response = await page.request.fetch(`${API_URL}/api/v1${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.data ? { 'Content-Type': 'application/json' } : {}),
    },
    data: init.data,
  });
  if (!response.ok()) {
    const errorBody = await response.text();
    throw new Error(`API ${init.method ?? 'GET'} ${path} failed (${response.status()}): ${errorBody}`);
  }
  return response.json() as Promise<ApiJsonBody<T>>;
}

export async function login(page: Page, email = DEFAULT_EMAIL, password = DEFAULT_PASSWORD) {
  await page.goto('/login');
  await page.getByLabel(/Email address/i).fill(email);
  await page.getByLabel(/^Password/i).fill(password);
  await page.getByRole('button', { name: /^Sign in$/i }).click();
  await page.waitForURL('**/dashboard', { timeout: 15_000 });
  await page.waitForLoadState('domcontentloaded');
  const switcher = page.getByTestId('workspace-switcher');
  if (await switcher.count()) {
    await expect(switcher).toBeVisible({ timeout: 15_000 });
  }
}

export async function waitForUnreadCount(page: Page, count: number, timeoutMs = 15_000) {
  await expect
    .poll(
      async () => {
        const body = await fetchApiJson<{ count: number }>(
          page,
          '/notifications/unread-count',
        );
        return body.data.count;
      },
      { timeout: timeoutMs },
    )
    .toBe(count);
}

export async function switchWorkspace(page: Page, slug: string) {
  const token = await readAccessToken(page);
  const workspaceId = await page.evaluate((targetSlug) => {
    const raw = localStorage.getItem('smartroute-auth');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      state?: { user?: { workspaces?: Array<{ id: string; slug: string }> } };
    };
    return parsed.state?.user?.workspaces?.find((w) => w.slug === targetSlug)?.id ?? null;
  }, slug);

  expect(workspaceId).toBeTruthy();
  const activeWorkspaceId = workspaceId as string;

  const response = await page.request.post(`${API_URL}/api/v1/auth/switch-workspace`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { workspaceId: activeWorkspaceId },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();

  await page.evaluate(
    ({ user, tokens, currentWorkspaceId }) => {
      const raw = localStorage.getItem('smartroute-auth');
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        state?: {
          user?: unknown;
          accessToken?: string;
          refreshToken?: string;
          currentWorkspaceId?: string;
        };
      };
      if (!parsed.state) return;
      parsed.state.user = user;
      parsed.state.accessToken = tokens.accessToken;
      parsed.state.refreshToken = tokens.refreshToken;
      parsed.state.currentWorkspaceId = currentWorkspaceId;
      localStorage.setItem('smartroute-auth', JSON.stringify(parsed));
    },
    {
      user: body.data.user,
      tokens: body.data.tokens,
      currentWorkspaceId: activeWorkspaceId,
    },
  );

  await page.reload();
  await expect(page.getByTestId('workspace-switcher')).toContainText(`@${slug}`, { timeout: 10_000 });
}
