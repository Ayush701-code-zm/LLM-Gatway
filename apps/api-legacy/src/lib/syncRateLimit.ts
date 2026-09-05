import { prisma } from '@smartroute/database';
import { PLAN_LIMITS } from '@smartroute/shared';

/** Keeps the rate_limits table in sync with workspace plan + overrides. */
export async function syncRateLimitRecord(workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: {
      plan: true,
      requestsPerMinute: true,
      requestsPerDay: true,
      tokensPerMinute: true,
    },
  });

  const planLimits = PLAN_LIMITS[workspace.plan as keyof typeof PLAN_LIMITS] ?? PLAN_LIMITS.FREE;
  const requestsPerMinute = workspace.requestsPerMinute ?? planLimits.requestsPerMinute;
  const requestsPerDay = workspace.requestsPerDay ?? planLimits.requestsPerDay;
  const tokensPerMinute = workspace.tokensPerMinute ?? planLimits.tokensPerMinute;

  await prisma.rateLimit.upsert({
    where: { workspaceId },
    create: {
      workspaceId,
      plan: workspace.plan,
      requestsPerMinute,
      requestsPerHour: planLimits.requestsPerHour,
      requestsPerDay,
      tokensPerMinute,
      tokensPerDay: BigInt(planLimits.tokensPerDay),
    },
    update: {
      plan: workspace.plan,
      requestsPerMinute,
      requestsPerHour: planLimits.requestsPerHour,
      requestsPerDay,
      tokensPerMinute,
      tokensPerDay: BigInt(planLimits.tokensPerDay),
    },
  });
}
