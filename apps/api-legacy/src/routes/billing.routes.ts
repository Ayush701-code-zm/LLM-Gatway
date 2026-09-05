/**
 * Stripe billing routes.
 *
 * POST /billing/checkout       — create Stripe checkout session (upgrade plan)
 * POST /billing/portal         — customer portal session
 * POST /billing/webhook        — Stripe webhook (raw body)
 * GET  /billing/plans          — available plans
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { loadWorkspaceRole, canOwner } from '../middleware/workspaceRole';
import { validate } from '../middleware/validate';
import { getAuthWorkspaceId, getAuthUserId } from '../lib/workspaceContext';
import { prisma } from '@smartroute/database';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../config/logger';
import { handleStripeEvent } from '../lib/stripeWebhook';

export const billingRouter = Router();

const CheckoutSchema = z.object({
  plan: z.enum(['PRO', 'ENTERPRISE']),
});

billingRouter.get('/plans', (_req, res) => {
  res.json({
    success: true,
    data: [
      { id: 'FREE',       name: 'Free',       priceUsd: 0,   limits: { rpm: 10,   apiKeys: 2,  members: 1 } },
      { id: 'PRO',        name: 'Pro',        priceUsd: 49,  limits: { rpm: 60,   apiKeys: 20, members: 10 } },
      { id: 'ENTERPRISE', name: 'Enterprise', priceUsd: 499, limits: { rpm: 1000, apiKeys: -1, members: -1 } },
    ],
  });
});

billingRouter.get(
  '/status',
  requireAuth,
  loadWorkspaceRole,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspace = await prisma.workspace.findUniqueOrThrow({
        where:  { id: req.user!.workspaceId },
        select: { plan: true, stripeCustomerId: true },
      });

      res.json({
        success: true,
        data: {
          currentPlan:       workspace.plan,
          stripeConfigured:  Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_PRO),
          hasBillingAccount: Boolean(workspace.stripeCustomerId),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

async function getStripe() {
  if (!env.STRIPE_SECRET_KEY) {
    throw AppError.badRequest('Stripe is not configured');
  }
  const Stripe = (await import('stripe')).default;
  return new Stripe(env.STRIPE_SECRET_KEY);
}

billingRouter.post(
  '/checkout',
  requireAuth,
  loadWorkspaceRole,
  canOwner,
  validate(CheckoutSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { plan } = req.body as z.infer<typeof CheckoutSchema>;
      const workspaceId = getAuthWorkspaceId(req);
      const userId = getAuthUserId(req);

      const priceId = plan === 'PRO' ? env.STRIPE_PRICE_PRO : env.STRIPE_PRICE_ENTERPRISE;
      if (!priceId) throw AppError.badRequest(`Stripe price not configured for ${plan}`);

      const user = await prisma.user.findUniqueOrThrow({
        where:  { id: userId },
        select: { email: true },
      });

      const workspace = await prisma.workspace.findUniqueOrThrow({
        where:  { id: workspaceId },
        select: { stripeCustomerId: true, name: true },
      });

      const stripe = await getStripe();

      let customerId = workspace.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email:    user.email,
          name:     workspace.name,
          metadata: { workspaceId },
        });
        customerId = customer.id;
        await prisma.workspace.update({
          where: { id: workspaceId },
          data:  { stripeCustomerId: customerId },
        });
      }

      const session = await stripe.checkout.sessions.create({
        mode:                 'subscription',
        customer:             customerId,
        line_items:           [{ price: priceId, quantity: 1 }],
        success_url:          `${env.API_BASE_URL.replace(':3001', ':3000')}/settings?billing=success`,
        cancel_url:           `${env.API_BASE_URL.replace(':3001', ':3000')}/settings?billing=cancelled`,
        metadata:             { workspaceId, plan },
        subscription_data:    { metadata: { workspaceId, plan } },
      });

      res.status(200).json({ success: true, data: { url: session.url, sessionId: session.id } });
    } catch (err) {
      next(err);
    }
  },
);

billingRouter.post(
  '/portal',
  requireAuth,
  loadWorkspaceRole,
  canOwner,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const stripe = await getStripe();
      const workspaceId = getAuthWorkspaceId(req);

      const workspace = await prisma.workspace.findUniqueOrThrow({
        where:  { id: workspaceId },
        select: { stripeCustomerId: true },
      });

      if (!workspace.stripeCustomerId) {
        throw AppError.badRequest('No billing account found. Complete checkout first.');
      }

      const session = await stripe.billingPortal.sessions.create({
        customer:   workspace.stripeCustomerId,
        return_url: `${env.API_BASE_URL.replace(':3001', ':3000')}/settings`,
      });

      res.status(200).json({ success: true, data: { url: session.url } });
    } catch (err) {
      next(err);
    }
  },
);

/** Stripe webhook — mount with raw body in index.ts */
export async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    res.status(503).json({ success: false, error: { message: 'Stripe webhook not configured' } });
    return;
  }

  try {
    const stripe = await getStripe();
    const sig = req.headers['stripe-signature'] as string;
    const event = stripe.webhooks.constructEvent(req.body as Buffer, sig, env.STRIPE_WEBHOOK_SECRET);
    await handleStripeEvent(event);

    res.status(200).json({ received: true });
  } catch (err) {
    logger.error({ err }, 'Stripe webhook error');
    res.status(400).json({ success: false, error: { message: (err as Error).message } });
  }
}
