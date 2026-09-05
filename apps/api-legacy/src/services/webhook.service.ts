/**
 * Webhook Delivery Service
 *
 * Responsibilities:
 *   1. CRUD for workspace webhooks (create, list, update, delete, rotate secret).
 *   2. `dispatch()` — validates active webhooks for an event, enqueues delivery jobs.
 *   3. `deliver()` — called by the BullMQ worker; POSTs the payload to the target URL
 *      with HMAC-SHA256 signature, stores the delivery record, retries on failure.
 *
 * Security:
 *   Every delivery includes an `X-SmartRoute-Signature-256` header:
 *     HMAC-SHA256(signingSecret, `t=${timestamp}.${rawBody}`)
 *   Receivers should verify this before processing events.
 *
 * Retry policy (exponential backoff):
 *   attempt 1 → immediate
 *   attempt 2 → 60s
 *   attempt 3 → 300s (5 min)
 *   After 3 failures the webhook is marked FAILED (auto-disabled).
 *   Users can re-enable it via PATCH /webhooks/:id/enable.
 */

import crypto from 'node:crypto';
import { prisma } from '@smartroute/database';
import { encryptSecret, resolveSecret } from '../lib/crypto';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../config/logger';

export type WebhookEvent =
  | 'budget.warning'
  | 'budget.critical'
  | 'anomaly.detected'
  | 'budget.exceeded'
  | 'provider.down'
  | 'provider.recovered'
  | 'circuit_breaker.open'
  | 'circuit_breaker.closed'
  | 'rate_limit.exceeded'
  | 'anomaly.detected';

export interface WebhookPayload {
  id:          string;   // delivery ID (for idempotency)
  event:       WebhookEvent;
  workspaceId: string;
  createdAt:   string;   // ISO timestamp
  data:        Record<string, unknown>;
}

const MAX_FAILURES   = 3;
const RETRY_DELAYS   = [0, 60_000, 300_000] as const;  // ms: 0s, 60s, 5min

class WebhookService {
  // ── Secret management ────────────────────────────────────────

  generateSecret(): string {
    return `whs_${crypto.randomBytes(24).toString('hex')}`;
  }

  private sign(secret: string, payload: string, timestamp: number): string {
    const data = `t=${timestamp}.${payload}`;
    return `v1=${crypto.createHmac('sha256', secret).update(data).digest('hex')}`;
  }

  // ── CRUD ─────────────────────────────────────────────────────

  async create(workspaceId: string, data: {
    name:   string;
    url:    string;
    events: string[];
  }) {
    const secret = this.generateSecret();
    const encryptedSecret = encryptSecret(secret);

    const webhook = await prisma.webhook.create({
      data: {
        workspaceId,
        name:          data.name,
        url:           data.url,
        signingSecret: encryptedSecret,
        events:        data.events,
      },
      select: {
        id: true, name: true, url: true,
        events: true, status: true,
        createdAt: true,
      },
    });

    logger.info({ webhookId: webhook.id, workspaceId }, 'Webhook created');
    return { ...webhook, signingSecret: secret };
  }

  async list(workspaceId: string) {
    return prisma.webhook.findMany({
      where: { workspaceId },
      select: {
        id: true, name: true, url: true,
        events: true, status: true,
        failureCount: true, lastTriggeredAt: true,
        createdAt: true, updatedAt: true,
        // Never return signingSecret in list
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(webhookId: string, workspaceId: string) {
    const webhook = await prisma.webhook.findFirst({
      where: { id: webhookId, workspaceId },
      select: {
        id: true, name: true, url: true,
        events: true, status: true,
        failureCount: true, lastTriggeredAt: true,
        createdAt: true, updatedAt: true,
      },
    });
    if (!webhook) throw AppError.notFound('Webhook not found');
    return webhook;
  }

  async update(webhookId: string, workspaceId: string, data: {
    name?:   string;
    url?:    string;
    events?: string[];
    status?: 'ACTIVE' | 'INACTIVE';
  }) {
    const existing = await this.get(webhookId, workspaceId);
    const updated = await prisma.webhook.update({
      where: { id: existing.id },
      data:  { ...data, failureCount: data.status === 'ACTIVE' ? 0 : undefined },
      select: {
        id: true, name: true, url: true,
        events: true, status: true, createdAt: true, updatedAt: true,
      },
    });
    return updated;
  }

  async rotateSecret(webhookId: string, workspaceId: string) {
    const existing = await this.get(webhookId, workspaceId);
    const newSecret = this.generateSecret();
    await prisma.webhook.update({
      where: { id: existing.id },
      data:  { signingSecret: encryptSecret(newSecret) },
    });
    return { id: existing.id, signingSecret: newSecret };
  }

  async delete(webhookId: string, workspaceId: string) {
    await this.get(webhookId, workspaceId);
    await prisma.webhook.delete({ where: { id: webhookId } });
  }

  // ── Dispatch ──────────────────────────────────────────────────

  /**
   * Find all active webhooks subscribed to `event` and create pending delivery records.
   * Returns the delivery IDs so the caller can enqueue BullMQ jobs.
   */
  async dispatch(workspaceId: string, event: WebhookEvent, data: Record<string, unknown>): Promise<string[]> {
    const webhooks = await prisma.webhook.findMany({
      where: {
        workspaceId,
        status: 'ACTIVE',
        OR: [
          { events: { isEmpty: true } },          // subscribed to all events
          { events: { has: event } },              // subscribed to this specific event
        ],
      },
      select: { id: true },
    });

    if (webhooks.length === 0) return [];

    const payload: Omit<WebhookPayload, 'id'> = {
      event,
      workspaceId,
      createdAt: new Date().toISOString(),
      data,
    };

    const deliveries = await Promise.all(
      webhooks.map((wh) =>
        prisma.webhookDelivery.create({
          data: {
            webhookId:   wh.id,
            workspaceId,
            event,
            payload:     payload as never,
            status:      'PENDING',
            nextRetryAt: new Date(),
          },
          select: { id: true },
        }),
      ),
    );

    const ids = deliveries.map((d) => d.id);
    logger.debug({ event, workspaceId, deliveries: ids.length }, 'Webhook deliveries queued');
    return ids;
  }

  // ── Deliver (called by worker) ────────────────────────────────

  async deliver(deliveryId: string): Promise<void> {
    const delivery = await prisma.webhookDelivery.findUnique({
      where:   { id: deliveryId },
      include: { webhook: { select: { url: true, signingSecret: true, failureCount: true, id: true } } },
    });

    if (!delivery) {
      logger.warn({ deliveryId }, 'Webhook delivery record not found — skipping');
      return;
    }

    if (delivery.status === 'DELIVERED') return; // idempotent

    const rawBody   = JSON.stringify({ ...delivery.payload as object, id: deliveryId });
    const timestamp = Date.now();
    const secret = resolveSecret(delivery.webhook.signingSecret);
    const signature = this.sign(secret, rawBody, timestamp);

    const attempt = delivery.attempts + 1;
    const start   = Date.now();

    try {
      const controller = new AbortController();
      const timeout     = setTimeout(() => controller.abort(), 10_000); // 10s timeout

      const res = await fetch(delivery.webhook.url, {
        method:  'POST',
        headers: {
          'Content-Type':                   'application/json',
          'X-SmartRoute-Event':             delivery.event,
          'X-SmartRoute-Delivery-ID':       deliveryId,
          'X-SmartRoute-Timestamp':         String(timestamp),
          'X-SmartRoute-Signature-256':     signature,
          'User-Agent':                     'SmartRoute-Webhook/1.0',
        },
        body:    rawBody,
        signal:  controller.signal,
      });

      clearTimeout(timeout);

      const latencyMs    = Date.now() - start;
      const responseBody = (await res.text()).slice(0, 500);

      if (res.ok) {
        // Success
        await prisma.$transaction([
          prisma.webhookDelivery.update({
            where: { id: deliveryId },
            data:  {
              status:         'DELIVERED',
              responseStatus: res.status,
              responseBody,
              attempts:       attempt,
              latencyMs,
              deliveredAt:    new Date(),
              nextRetryAt:    null,
            },
          }),
          prisma.webhook.update({
            where: { id: delivery.webhookId },
            data:  { failureCount: 0, lastTriggeredAt: new Date() },
          }),
        ]);

        logger.info({ deliveryId, webhookId: delivery.webhookId, latencyMs }, 'Webhook delivered');
      } else {
        await this.handleFailure(delivery, attempt, latencyMs, res.status, responseBody);
      }
    } catch (err: unknown) {
      const latencyMs = Date.now() - start;
      const message   = err instanceof Error ? err.message : 'Unknown error';
      await this.handleFailure(delivery, attempt, latencyMs, null, message);
    }
  }

  private async handleFailure(
    delivery: { id: string; webhookId: string; webhook: { id: string; failureCount: number } },
    attempt:  number,
    latencyMs: number,
    responseStatus: number | null,
    responseBody:   string,
  ): Promise<void> {
    const newFailureCount = delivery.webhook.failureCount + 1;
    const isFinalAttempt  = attempt >= MAX_FAILURES;

    const nextRetryDelay = RETRY_DELAYS[attempt] ?? 0; // ms
    const nextRetryAt    = isFinalAttempt ? null : new Date(Date.now() + nextRetryDelay);

    await prisma.$transaction([
      prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data:  {
          status:         isFinalAttempt ? 'FAILED' : 'RETRYING',
          responseStatus: responseStatus ?? undefined,
          responseBody,
          attempts:       attempt,
          latencyMs,
          nextRetryAt,
        },
      }),
      prisma.webhook.update({
        where: { id: delivery.webhookId },
        data:  {
          failureCount: newFailureCount,
          // Auto-disable after too many consecutive failures
          ...(newFailureCount >= MAX_FAILURES && { status: 'FAILED' }),
        },
      }),
    ]);

    logger.warn(
      { deliveryId: delivery.id, webhookId: delivery.webhookId, attempt, isFinalAttempt, responseBody },
      isFinalAttempt ? 'Webhook permanently failed — auto-disabled' : 'Webhook delivery failed — will retry',
    );
  }

  // ── Delivery logs ─────────────────────────────────────────────

  async getDeliveries(webhookId: string, workspaceId: string, limit = 50) {
    // Verify ownership
    await this.get(webhookId, workspaceId);

    return prisma.webhookDelivery.findMany({
      where:   { webhookId },
      orderBy: { createdAt: 'desc' },
      take:    limit,
      select: {
        id: true, event: true, status: true,
        responseStatus: true, attempts: true,
        latencyMs: true, deliveredAt: true,
        createdAt: true,
      },
    });
  }
}

export const webhookService = new WebhookService();
