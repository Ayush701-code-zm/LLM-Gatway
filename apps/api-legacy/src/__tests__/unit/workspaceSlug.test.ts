import { describe, it, expect } from 'vitest';
import { RegisterSchema, WorkspaceSlugSchema } from '@smartroute/shared';
import { isReservedWorkspaceSlug, RESERVED_WORKSPACE_SLUGS } from '@smartroute/shared';

describe('workspace slug validation', () => {
  it('rejects reserved slugs', () => {
    for (const slug of ['admin', 'api', 'login', 'saml']) {
      expect(isReservedWorkspaceSlug(slug)).toBe(true);
      expect(WorkspaceSlugSchema.safeParse(slug).success).toBe(false);
    }
  });

  it('allows non-reserved slugs', () => {
    expect(WorkspaceSlugSchema.safeParse('acme-corp').success).toBe(true);
    expect(isReservedWorkspaceSlug('acme-corp')).toBe(false);
  });

  it('rejects reserved slug on register payload', () => {
    const result = RegisterSchema.safeParse({
      name: 'Test User',
      email: 'test@example.com',
      password: 'password123',
      workspaceSlug: 'dashboard',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/reserved/i);
    }
  });

  it('exports a non-empty reserved list', () => {
    expect(RESERVED_WORKSPACE_SLUGS.size).toBeGreaterThan(10);
  });
});
