import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted — cannot reference module-level variables inside factory.
// Use vi.fn() directly; grab references after import.

vi.mock('@smartroute/database', () => ({
  prisma: {
    budget: {
      findMany:   vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock('../../config/redis', () => ({
  getRedis: () => ({
    pipeline: vi.fn().mockReturnValue({
      incrbyfloat: vi.fn().mockReturnThis(),
      expire:      vi.fn().mockReturnThis(),
      exec:        vi.fn().mockResolvedValue([[null, 0.5]]),
    }),
    get:         vi.fn(),
    set:         vi.fn(),
    incrbyfloat: vi.fn(),
  }),
}));

import { BudgetGuardEngine } from '../../engines/budgetGuard';
import { prisma }            from '@smartroute/database';

// Full budget record with all required fields
const makeBudget = (overrides: Partial<{
  id: string; limitUsd: number; currentSpend: number; isActive: boolean;
  name: string; blockAt100: boolean; alertAt80: boolean; alertAt90: boolean;
}> = {}) => ({
  id:          'b1',
  limitUsd:    100,
  currentSpend: 0,
  isActive:    true,
  name:        'Test Budget',
  blockAt100:  true,
  alertAt80:   false,
  alertAt90:   false,
  ...overrides,
});

describe('BudgetGuardEngine', () => {
  let guard: BudgetGuardEngine;
  const workspaceId = 'ws-test-123';

  beforeEach(() => {
    vi.clearAllMocks();
    guard = new BudgetGuardEngine();
  });

  // ── check() ──────────────────────────────────────────────────
  describe('check()', () => {
    it('passes when no active budgets exist', async () => {
      vi.mocked(prisma.budget.findMany).mockResolvedValue([]);
      await expect(guard.check(workspaceId, 0)).resolves.not.toThrow();
    });

    it('passes when spend is under limit', async () => {
      vi.mocked(prisma.budget.findMany).mockResolvedValue([
        makeBudget({ limitUsd: 100, currentSpend: 50 }) as never,
      ]);
      await expect(guard.check(workspaceId, 0.01)).resolves.not.toThrow();
    });

    it('throws BUDGET_EXCEEDED when current spend >= limit and blockAt100=true', async () => {
      vi.mocked(prisma.budget.findMany).mockResolvedValue([
        makeBudget({ limitUsd: 10, currentSpend: 10.50, blockAt100: true }) as never,
      ]);
      await expect(guard.check(workspaceId, 0)).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
    });

    it('does NOT throw when blockAt100=false, even if over limit', async () => {
      vi.mocked(prisma.budget.findMany).mockResolvedValue([
        makeBudget({ limitUsd: 10, currentSpend: 12, blockAt100: false }) as never,
      ]);
      await expect(guard.check(workspaceId, 0)).resolves.not.toThrow();
    });

    it('throws when additional cost would exceed limit', async () => {
      vi.mocked(prisma.budget.findMany).mockResolvedValue([
        makeBudget({ limitUsd: 10, currentSpend: 9.95, blockAt100: true }) as never,
      ]);
      await expect(guard.check(workspaceId, 0.10)).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
    });

    it('passes when additional cost stays under limit', async () => {
      vi.mocked(prisma.budget.findMany).mockResolvedValue([
        makeBudget({ limitUsd: 10, currentSpend: 9.00 }) as never,
      ]);
      await expect(guard.check(workspaceId, 0.50)).resolves.not.toThrow();
    });

    it('only queries active budgets', async () => {
      vi.mocked(prisma.budget.findMany).mockResolvedValue([]);
      await guard.check(workspaceId, 0);
      expect(prisma.budget.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ isActive: true }) }),
      );
    });
  });

  // ── recordSpend() ─────────────────────────────────────────────
  describe('recordSpend()', () => {
    it('increments currentSpend in DB via updateMany', async () => {
      vi.mocked(prisma.budget.updateMany).mockResolvedValue({ count: 1 });
      await guard.recordSpend(workspaceId, 0.05);
      expect(prisma.budget.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ workspaceId, isActive: true }),
          data:  expect.objectContaining({ currentSpend: { increment: 0.05 } }),
        }),
      );
    });
  });
});
