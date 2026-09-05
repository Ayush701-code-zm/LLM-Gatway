import { prisma } from '@smartroute/database';
import { getRedis } from '../config/redis';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { syncRateLimitRecord } from './syncRateLimit';

type PlanTier = 'FREE' | 'PRO' | 'ENTERPRISE';

function planFromPriceId(priceId: string | undefined): PlanTier | null {
  if (!priceId) return null;
  if (priceId === env.STRIPE_PRICE_PRO) return 'PRO';
  if (priceId === env.STRIPE_PRICE_ENTERPRISE) return 'ENTERPRISE';
  return null;
}

async function isDuplicateEvent(eventId: string): Promise<boolean> {
  const redis = getRedis();
  const key = `stripe:event:${eventId}`;
  const inserted = await redis.set(key, '1', 'EX', 7 * 24 * 60 * 60, 'NX');
  return inserted === null;
}

async function applyWorkspacePlan(
  workspaceId: string,
  plan: PlanTier,
  customerId?: string,
): Promise<void> {
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      plan,
      ...(customerId ? { stripeCustomerId: customerId } : {}),
    },
  });
  await syncRateLimitRecord(workspaceId);
}

export async function handleStripeEvent(event: {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}): Promise<void> {
  if (await isDuplicateEvent(event.id)) {
    logger.info({ eventId: event.id, type: event.type }, 'Stripe event already processed');
    return;
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as {
        metadata?: { workspaceId?: string; plan?: string };
        customer?: string | { id: string } | null;
      };
      const workspaceId = session.metadata?.workspaceId;
      const plan = session.metadata?.plan as PlanTier | undefined;
      const customerId = typeof session.customer === 'string'
        ? session.customer
        : session.customer?.id;

      if (workspaceId && plan && plan !== 'FREE') {
        await applyWorkspacePlan(workspaceId, plan, customerId);
        logger.info({ workspaceId, plan }, 'Workspace plan upgraded via Stripe checkout');
      }
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as {
        metadata?: { workspaceId?: string; plan?: string };
        status?: string;
        items?: { data?: Array<{ price?: { id?: string } }> };
      };
      const workspaceId = sub.metadata?.workspaceId;
      if (!workspaceId) break;

      if (sub.status === 'canceled' || sub.status === 'unpaid' || sub.status === 'incomplete_expired') {
        await applyWorkspacePlan(workspaceId, 'FREE');
        logger.info({ workspaceId, status: sub.status }, 'Workspace downgraded via subscription update');
        break;
      }

      const priceId = sub.items?.data?.[0]?.price?.id;
      const plan = (sub.metadata?.plan as PlanTier | undefined) ?? planFromPriceId(priceId);
      if (plan && plan !== 'FREE') {
        await applyWorkspacePlan(workspaceId, plan);
        logger.info({ workspaceId, plan }, 'Workspace plan synced via subscription update');
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as { metadata?: { workspaceId?: string } };
      const workspaceId = sub.metadata?.workspaceId;
      if (workspaceId) {
        await applyWorkspacePlan(workspaceId, 'FREE');
        logger.info({ workspaceId }, 'Workspace downgraded to FREE');
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as {
        customer?: string | { id?: string } | null;
        subscription_details?: { metadata?: { workspaceId?: string } };
      };
      const customerId = typeof invoice.customer === 'string'
        ? invoice.customer
        : invoice.customer?.id;

      let workspaceId = invoice.subscription_details?.metadata?.workspaceId;
      if (!workspaceId && customerId) {
        const workspace = await prisma.workspace.findFirst({
          where: { stripeCustomerId: customerId },
          select: { id: true },
        });
        workspaceId = workspace?.id;
      }

      if (workspaceId) {
        await prisma.notification.create({
          data: {
            workspaceId,
            type: 'BUDGET_CRITICAL',
            title: 'Payment failed',
            body: 'Your subscription payment failed. Update your billing details to avoid service interruption.',
            metadata: { source: 'stripe', eventId: event.id },
          },
        });
        logger.warn({ workspaceId }, 'Stripe invoice payment failed');
      }
      break;
    }

    default:
      logger.debug({ type: event.type }, 'Unhandled Stripe event');
  }
}
