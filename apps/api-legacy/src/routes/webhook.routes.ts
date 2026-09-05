/**
 * Webhook management routes.
 *
 * All endpoints are scoped to the authenticated user's current workspace.
 *
 * GET    /api/v1/webhooks              — list webhooks
 * POST   /api/v1/webhooks              — create webhook
 * GET    /api/v1/webhooks/:id          — get single webhook
 * PATCH  /api/v1/webhooks/:id          — update webhook
 * DELETE /api/v1/webhooks/:id          — delete webhook
 * POST   /api/v1/webhooks/:id/rotate-secret  — rotate signing secret
 * GET    /api/v1/webhooks/:id/deliveries     — delivery log (last 50)
 * POST   /api/v1/webhooks/:id/test           — send a test ping event
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { loadWorkspaceRole, canAdmin } from '../middleware/workspaceRole';
import { validate } from '../middleware/validate';
import { webhookService } from '../services/webhook.service';
import { enqueueWebhookDelivery } from '../queues/index';
import { AppError } from '../middleware/errorHandler';
import { getAuthWorkspaceId } from '../lib/workspaceContext';

export const webhookRouter = Router();

// ── Validation schemas ────────────────────────────────────────

const VALID_EVENTS = [
  'budget.warning', 'budget.critical', 'budget.exceeded',
  'provider.down', 'provider.recovered',
  'circuit_breaker.open', 'circuit_breaker.closed',
  'rate_limit.exceeded', 'anomaly.detected',
] as const;

const CreateWebhookSchema = z.object({
  name:   z.string().min(1).max(100),
  url:    z.string().url('Must be a valid HTTPS URL').refine(
    (u) => u.startsWith('https://') || u.startsWith('http://localhost'),
    'Webhook URL must use HTTPS (or http://localhost for testing)',
  ),
  events: z.array(z.enum(VALID_EVENTS)).default([]),
});

const PatchWebhookSchema = CreateWebhookSchema.partial().extend({
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

// ── Helper ────────────────────────────────────────────────────

function getWorkspaceId(req: Request): string {
  return getAuthWorkspaceId(req);
}

// ── Routes ────────────────────────────────────────────────────

webhookRouter.get('/', requireAuth, loadWorkspaceRole, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const list = await webhookService.list(getWorkspaceId(req));
    res.status(200).json({ success: true, data: list });
  } catch (err) { next(err); }
});

webhookRouter.post(
  '/',
  requireAuth,
  loadWorkspaceRole,
  canAdmin,
  validate(CreateWebhookSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const webhook = await webhookService.create(getWorkspaceId(req), req.body);
      // Return the signing secret ONCE — it won't be shown again
      res.status(201).json({
        success: true,
        data: webhook,
        meta: {
          signingSecretNote:
            'Store this signing secret securely — it will not be shown again. ' +
            'Use it to verify X-SmartRoute-Signature-256 on incoming deliveries.',
        },
      });
    } catch (err) { next(err); }
  },
);

webhookRouter.get('/:id', requireAuth, loadWorkspaceRole, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const webhook = await webhookService.get(String(req.params.id), getWorkspaceId(req));
    res.status(200).json({ success: true, data: webhook });
  } catch (err) { next(err); }
});

webhookRouter.patch(
  '/:id',
  requireAuth,
  loadWorkspaceRole,
  canAdmin,
  validate(PatchWebhookSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const webhook = await webhookService.update(String(req.params.id), getWorkspaceId(req), req.body);
      res.status(200).json({ success: true, data: webhook });
    } catch (err) { next(err); }
  },
);

webhookRouter.delete('/:id', requireAuth, loadWorkspaceRole, canAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await webhookService.delete(String(req.params.id), getWorkspaceId(req));
    res.status(204).send();
  } catch (err) { next(err); }
});

webhookRouter.post('/:id/rotate-secret', requireAuth, loadWorkspaceRole, canAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await webhookService.rotateSecret(String(req.params.id), getWorkspaceId(req));
    res.status(200).json({
      success: true,
      data: result,
      meta: { signingSecretNote: 'Update your receiver to use the new secret immediately.' },
    });
  } catch (err) { next(err); }
});

webhookRouter.get('/:id/deliveries', requireAuth, loadWorkspaceRole, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const deliveries = await webhookService.getDeliveries(String(req.params.id), getWorkspaceId(req), limit);
    res.status(200).json({ success: true, data: deliveries });
  } catch (err) { next(err); }
});

/**
 * Test endpoint — immediately delivers a synthetic ping event to the webhook.
 * Useful for verifying the receiving server is correctly set up.
 */
webhookRouter.post('/:id/test', requireAuth, loadWorkspaceRole, canAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = getWorkspaceId(req);
    const webhook = await webhookService.get(String(req.params.id), workspaceId);

    if (webhook.status !== 'ACTIVE') {
      throw AppError.badRequest('Cannot test an inactive webhook. Enable it first.');
    }

    const [deliveryId] = await webhookService.dispatch(workspaceId, 'budget.warning', {
      test: true,
      message: 'This is a test delivery from SmartRoute AI.',
      timestamp: new Date().toISOString(),
    });

    if (!deliveryId) {
      throw AppError.internal('Could not create test delivery');
    }

    // Deliver immediately (no delay)
    await enqueueWebhookDelivery(deliveryId, 0);

    res.status(202).json({
      success: true,
      data:    { deliveryId, message: 'Test delivery queued. Check /deliveries for the result.' },
    });
  } catch (err) { next(err); }
});
