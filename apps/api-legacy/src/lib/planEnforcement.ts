import { prisma } from '@smartroute/database';
import { PLAN_LIMITS } from '@smartroute/shared';
import { AppError } from '../middleware/errorHandler';

type PlanKey = keyof typeof PLAN_LIMITS;

export async function getWorkspacePlan(workspaceId: string): Promise<PlanKey> {
  const ws = await prisma.workspace.findUnique({
    where:  { id: workspaceId },
    select: { plan: true },
  });
  return (ws?.plan ?? 'FREE') as PlanKey;
}

export async function enforceApiKeyLimit(workspaceId: string): Promise<void> {
  const plan = await getWorkspacePlan(workspaceId);
  const limit = PLAN_LIMITS[plan].maxApiKeys;
  if (limit < 0) return;

  const count = await prisma.apiKey.count({
    where: { workspaceId, status: { not: 'REVOKED' } },
  });

  if (count >= limit) {
    throw AppError.forbidden(
      `API key limit reached for ${plan} plan (${limit}). Upgrade to create more keys.`,
    );
  }
}

export async function enforceMemberLimit(workspaceId: string): Promise<void> {
  const plan = await getWorkspacePlan(workspaceId);
  const limit = PLAN_LIMITS[plan].maxWorkspaceMembers;
  if (limit < 0) return;

  const count = await prisma.workspaceMember.count({ where: { workspaceId } });

  if (count >= limit) {
    throw AppError.forbidden(
      `Member limit reached for ${plan} plan (${limit}). Upgrade to invite more members.`,
    );
  }
}

export async function enforceBudgetLimit(workspaceId: string, limitUsd: number): Promise<void> {
  const plan = await getWorkspacePlan(workspaceId);
  const maxBudget = PLAN_LIMITS[plan].budgetLimitUsd;
  if (maxBudget < 0) return;

  if (limitUsd > maxBudget) {
    throw AppError.forbidden(
      `Budget limit of $${maxBudget} exceeded for ${plan} plan. Upgrade for higher budgets.`,
    );
  }
}
