import { prisma } from '@smartroute/database';
import { BUDGET_THRESHOLDS } from '@smartroute/shared';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../config/logger';
import { dispatchWebhookEvent } from '../queues/index';

/**
 * Checks workspace budget before allowing a request.
 * Fires alerts at 80% and 90% thresholds.
 * Blocks at 100%.
 */
export class BudgetGuardEngine {
  async check(workspaceId: string, estimatedCostUsd = 0): Promise<void> {
    const activeBudgets = await prisma.budget.findMany({
      where: { workspaceId, isActive: true },
    });

    for (const budget of activeBudgets) {
      const projectedSpend = budget.currentSpend + estimatedCostUsd;
      const percentage = projectedSpend / budget.limitUsd;

      if (percentage >= BUDGET_THRESHOLDS.BLOCKED && budget.blockAt100) {
        logger.warn(
          { workspaceId, budgetId: budget.id, percentage },
          'Budget exceeded — blocking request',
        );
        throw AppError.budgetExceeded(
          `Budget "${budget.name}" has been exhausted ($${budget.limitUsd.toFixed(2)} limit)`,
        );
      }

      // Queue alert jobs (non-blocking)
      if (percentage >= BUDGET_THRESHOLDS.CRITICAL && budget.alertAt90) {
        this.queueAlert(workspaceId, budget.id, 'CRITICAL', percentage).catch(() => {});
        dispatchWebhookEvent(workspaceId, 'budget.critical', {
          budgetId: budget.id, budgetName: budget.name,
          percentUsed: Math.round(percentage * 100), limitUsd: budget.limitUsd,
        }).catch(() => {});
      } else if (percentage >= BUDGET_THRESHOLDS.WARNING && budget.alertAt80) {
        this.queueAlert(workspaceId, budget.id, 'WARNING', percentage).catch(() => {});
        dispatchWebhookEvent(workspaceId, 'budget.warning', {
          budgetId: budget.id, budgetName: budget.name,
          percentUsed: Math.round(percentage * 100), limitUsd: budget.limitUsd,
        }).catch(() => {});
      }
    }
  }

  async recordSpend(workspaceId: string, costUsd: number): Promise<void> {
    await prisma.budget.updateMany({
      where: { workspaceId, isActive: true },
      data: { currentSpend: { increment: costUsd } },
    });
  }

  private async queueAlert(
    workspaceId: string,
    budgetId: string,
    severity: 'WARNING' | 'CRITICAL',
    percentage: number,
  ): Promise<void> {
    // Idempotency: only create if no pending alert of this severity exists
    const existing = await prisma.budgetAlert.findFirst({
      where: { workspaceId, budgetId, severity, status: { in: ['PENDING', 'SENT'] } },
    });

    if (!existing) {
      await prisma.budgetAlert.create({
        data: {
          workspaceId,
          budgetId,
          severity,
          status: 'PENDING',
          threshold: severity === 'WARNING' ? 0.8 : 0.9,
          spendAtAlert: 0,
          message: `Budget has reached ${(percentage * 100).toFixed(1)}% of limit`,
        },
      });
    }
  }
}

export const budgetGuard = new BudgetGuardEngine();
