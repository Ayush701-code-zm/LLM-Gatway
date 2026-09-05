import { Queue, Worker } from 'bullmq';
import type { Prisma, ProviderName } from '@smartroute/database';
import { getBullMQConnectionOptions } from '../config/redis';
import { logger } from '../config/logger';
import { env } from '../config/env';
import { gatewayMetrics } from '../lib/gatewayMetrics';

// ===========================================================
// Queue names
// ===========================================================

export const QUEUE_NAMES = {
  ANALYTICS:          'analytics',
  EMBEDDINGS:         'embeddings',
  HEALTH_CHECKS:      'health-checks',
  BUDGET_MONITORING:  'budget-monitoring',
  NOTIFICATIONS:      'notifications',
  DAILY_AGGREGATIONS: 'daily-aggregations',
  CACHE_MAINTENANCE:  'cache-maintenance',
  WEBHOOKS:           'webhooks',
  ANOMALY_DETECTION:  'anomaly-detection',
  MODEL_PRICING:      'model-pricing',
} as const;

// Track workers for graceful shutdown
const activeWorkers: Worker[] = [];

// ===========================================================
// Queue instances (lazy-initialized)
// ===========================================================

let queues: Record<string, Queue> | null = null;

export function getQueues(): Record<string, Queue> {
  if (queues) return queues;

  const connection = getBullMQConnectionOptions();

  queues = Object.fromEntries(
    Object.entries(QUEUE_NAMES).map(([, name]) => [
      name,
      new Queue(name, {
        connection,
        defaultJobOptions: {
          removeOnComplete: 1000,
          removeOnFail:     500,
          attempts:         3,
          backoff: { type: 'exponential', delay: 2000 },
        },
      }),
    ]),
  );

  return queues;
}

// ── Queue depth reporter ──────────────────────────────────────

async function reportQueueDepths(): Promise<void> {
  const qs = getQueues();
  await Promise.allSettled(
    Object.entries(qs).map(async ([name, queue]) => {
      const waiting = await queue.getWaitingCount().catch(() => 0);
      gatewayMetrics.updateQueueDepth(name, waiting);
    }),
  );
}

// ===========================================================
// Worker starters
// ===========================================================

export function startWorkers(): void {
  const connection = getBullMQConnectionOptions();

  startAnalyticsWorker(connection);
  startHealthCheckWorker(connection);
  startDailyAggregationWorker(connection);
  startCacheMaintenanceWorker(connection);
  startBudgetNotificationsWorker(connection);
  startWebhookWorker(connection);
  startAnomalyDetectionWorker(connection);
  startModelPricingWorker(connection);

  logger.info('BullMQ workers started');
}

export async function shutdownWorkers(): Promise<void> {
  await Promise.allSettled(activeWorkers.map((w) => w.close()));
  if (queues) {
    await Promise.allSettled(Object.values(queues).map((q) => q.close()));
  }
  logger.info('BullMQ workers shut down');
}

type BullMQConnection = ReturnType<typeof getBullMQConnectionOptions>;

// ── Analytics worker ──────────────────────────────────────────
// Records per-request Prometheus metrics from the analytics queue.
// The gateway service pushes a job here after every request.

function trackWorker(worker: Worker): Worker {
  activeWorkers.push(worker);
  return worker;
}

function startAnalyticsWorker(connection: BullMQConnection): void {
  const worker = trackWorker(new Worker(
    QUEUE_NAMES.ANALYTICS,
    async (job) => {
      const {
        provider,
        model,
        workspaceId,
        status,
        latencyMs,
        actualCostUsd,
        baselineCostUsd,
        cacheHit,
      } = job.data as {
        provider:        string;
        model:           string;
        workspaceId:     string;
        status:          'success' | 'error' | 'fallback' | 'cached';
        latencyMs:       number;
        actualCostUsd:   number;
        baselineCostUsd: number;
        cacheHit:        boolean;
      };

      gatewayMetrics.recordRequest({
        provider,
        model,
        workspaceId,
        status,
        latencyMs,
        actualCostUsd,
        baselineCostUsd,
        cacheHit,
      });

      const { prisma } = await import('@smartroute/database');
      const recordedAt = new Date();
      await prisma.usageMetric.createMany({
        data: [
          {
            workspaceId,
            metricName: 'request_cost_usd',
            metricValue: actualCostUsd,
            labels: { provider, model, status },
            recordedAt,
          },
          {
            workspaceId,
            metricName: 'request_latency_ms',
            metricValue: latencyMs,
            labels: { provider, model, status },
            recordedAt,
          },
          {
            workspaceId,
            metricName: 'request_count',
            metricValue: 1,
            labels: { provider, model, status, cacheHit: String(cacheHit) },
            recordedAt,
          },
        ],
      });

      logger.debug({ jobId: job.id, provider, model, workspaceId }, 'Analytics job processed');
    },
    { connection, concurrency: env.QUEUE_CONCURRENCY_ANALYTICS },
  ));

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Analytics job failed');
  });
}

// ── Health check worker ───────────────────────────────────────
// Runs every 2 minutes. Pings each enabled model and writes to ProviderHealth.

function startHealthCheckWorker(connection: BullMQConnection): void {
  const worker = trackWorker(new Worker(
    QUEUE_NAMES.HEALTH_CHECKS,
    async (job) => {
      const { prisma } = await import('@smartroute/database');
      const { providerRegistry } = await import('../providers/registry');

      logger.debug({ jobId: job.id }, 'Running provider health checks');

      const models = await prisma.modelRegistry.findMany({
        where:  { isEnabled: true, supportsEmbeddings: false },
        select: { id: true, provider: true, modelId: true },
      });

      const results = await Promise.allSettled(
        models.map(async (model: typeof models[number]) => {
          const provider = providerRegistry.get(model.provider);
          if (!provider.isConfigured) return;

          const result = await provider.healthCheck(model.modelId);
          const status =
            result.status === 'available'  ? 'AVAILABLE'  :
            result.status === 'degraded'   ? 'DEGRADED'   :
                                             'UNAVAILABLE';

          await prisma.providerHealth.create({
            data: {
              modelRegistryId: model.id,
              status:          status as never,
              latencyMs:       result.latencyMs,
              errorMessage:    result.errorMessage,
            },
          });

          // Update Prometheus gauge
          gatewayMetrics.updateProviderHealth(model.provider, model.modelId, status === 'AVAILABLE');
          gatewayMetrics.updateCircuitBreaker(
            model.provider,
            model.modelId,
            status === 'AVAILABLE' ? 'CLOSED' : 'OPEN',
          );
        }),
      );

      const failed   = results.filter((r) => r.status === 'rejected').length;
      const succeeded = results.length - failed;
      logger.info({ succeeded, failed }, 'Health checks complete');

      // Persist infrastructure health snapshots
      const { getRedis } = await import('../config/redis');
      const infraChecks: Array<{ service: string; run: () => Promise<number> }> = [
        {
          service: 'database',
          run: async () => {
            const start = Date.now();
            await prisma.$queryRaw`SELECT 1`;
            return Date.now() - start;
          },
        },
        {
          service: 'redis',
          run: async () => {
            const start = Date.now();
            await getRedis().ping();
            return Date.now() - start;
          },
        },
      ];

      await Promise.allSettled(
        infraChecks.map(async ({ service, run }) => {
          try {
            const latencyMs = await run();
            await prisma.healthCheck.create({
              data: { service, status: 'healthy', latencyMs },
            });
          } catch (err) {
            await prisma.healthCheck.create({
              data: {
                service,
                status: 'unhealthy',
                details: { error: (err as Error).message },
              },
            });
          }
        }),
      );

      await prisma.healthCheck.create({
        data: {
          service: 'api',
          status: 'healthy',
          latencyMs: 0,
          details: { version: env.APP_VERSION, environment: env.NODE_ENV },
        },
      });
    },
    { connection, concurrency: env.QUEUE_CONCURRENCY_HEALTH_CHECKS },
  ));

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Health check job failed');
  });
}

// ── Daily aggregation worker ──────────────────────────────────
// Triggered by a per-workspace daily job. Aggregates request data into
// the spending_analytics table for fast dashboard queries.

type SpendingAnalyticClient = {
  spendingAnalytic: {
    findFirst: (args: Prisma.SpendingAnalyticFindFirstArgs) => Promise<{ id: string } | null>;
    create: (args: Prisma.SpendingAnalyticCreateArgs) => Promise<unknown>;
    update: (args: Prisma.SpendingAnalyticUpdateArgs) => Promise<unknown>;
    upsert: (args: Prisma.SpendingAnalyticUpsertArgs) => Promise<unknown>;
  };
};

async function upsertSpendingAnalytic(
  prisma: SpendingAnalyticClient,
  params: {
    workspaceId: string;
    date: Date;
    provider: ProviderName | null;
    create: Prisma.SpendingAnalyticCreateInput;
    update: Prisma.SpendingAnalyticUpdateInput;
  },
): Promise<void> {
  const { workspaceId, date, provider, create, update } = params;

  // Prisma upsert rejects null in composite unique keys — use find/update/create instead.
  if (provider === null) {
    const existing = await prisma.spendingAnalytic.findFirst({
      where: { workspaceId, date, provider: null },
      select: { id: true },
    });
    if (existing) {
      await prisma.spendingAnalytic.update({ where: { id: existing.id }, data: update });
      return;
    }
    await prisma.spendingAnalytic.create({ data: create });
    return;
  }

  await prisma.spendingAnalytic.upsert({
    where: { workspaceId_date_provider: { workspaceId, date, provider } },
    create,
    update,
  });
}

function startDailyAggregationWorker(connection: BullMQConnection): void {
  const worker = trackWorker(new Worker(
    QUEUE_NAMES.DAILY_AGGREGATIONS,
    async (job) => {
      const { prisma } = await import('@smartroute/database');

      const { workspaceId, date } = job.data as { workspaceId?: string; date?: string };

      // Scheduled job: enqueue per-workspace aggregation
      if (!workspaceId) {
        const workspaces = await prisma.workspace.findMany({
          where:  { isActive: true, deletedAt: null },
          select: { id: true },
        });
        await Promise.allSettled(
          workspaces.map((w) => triggerDailyAggregation(w.id, date)),
        );
        return;
      }

      const targetDate = date ? new Date(date) : new Date();
      targetDate.setHours(0, 0, 0, 0);

      const endDate = new Date(targetDate);
      endDate.setDate(endDate.getDate() + 1);

      logger.debug({ workspaceId, date: targetDate }, 'Running daily aggregation');

      // Overall stats
      const stats = await prisma.request.aggregate({
        where: {
          workspaceId,
          createdAt: { gte: targetDate, lt: endDate },
        },
        _count: { id: true },
        _sum: {
          actualCostUsd:   true,
          baselineCostUsd: true,
          savingsUsd:      true,
          inputTokens:     true,
          outputTokens:    true,
          totalLatencyMs:  true,
        },
        _avg: { totalLatencyMs: true },
      });

      const cacheStats = await prisma.request.groupBy({
        by:    ['cacheHit'],
        where: { workspaceId, createdAt: { gte: targetDate, lt: endDate } },
        _count: { id: true },
      });

      const cacheHitCount  = cacheStats.find((s: typeof cacheStats[number]) => s.cacheHit)?._count.id ?? 0;
      const cacheMissCount = cacheStats.find((s: typeof cacheStats[number]) => !s.cacheHit)?._count.id ?? 0;
      const totalRequests  = cacheHitCount + cacheMissCount;
      const cacheHitRate   = totalRequests > 0 ? cacheHitCount / totalRequests : 0;

      const errorStats = await prisma.request.count({
        where: {
          workspaceId,
          createdAt: { gte: targetDate, lt: endDate },
          status:    'FAILED',
        },
      });

      const errorRate = totalRequests > 0 ? errorStats / totalRequests : 0;

      // Per-provider breakdown
      const byProvider = await prisma.request.groupBy({
        by:    ['modelRegistryId'],
        where: { workspaceId, createdAt: { gte: targetDate, lt: endDate }, modelRegistryId: { not: null } },
        _count: { id: true },
        _sum:   { actualCostUsd: true, savingsUsd: true },
      });

      // Upsert overall daily record (null provider = workspace totals)
      await upsertSpendingAnalytic(prisma, {
        workspaceId,
        date: targetDate,
        provider: null,
        create: {
          workspaceId,
          date:            targetDate,
          provider:        null,
          totalRequests:   stats._count.id,
          actualCostUsd:   stats._sum.actualCostUsd   ?? 0,
          baselineCostUsd: stats._sum.baselineCostUsd ?? 0,
          totalSavingsUsd: stats._sum.savingsUsd      ?? 0,
          avgLatencyMs:    stats._avg.totalLatencyMs  ?? 0,
          cacheHitRate,
          errorRate,
        },
        update: {
          totalRequests:   stats._count.id,
          actualCostUsd:   stats._sum.actualCostUsd   ?? 0,
          baselineCostUsd: stats._sum.baselineCostUsd ?? 0,
          totalSavingsUsd: stats._sum.savingsUsd      ?? 0,
          avgLatencyMs:    stats._avg.totalLatencyMs  ?? 0,
          cacheHitRate,
          errorRate,
        },
      });

      // Per-provider breakdown upserts
      for (const row of byProvider) {
        if (!row.modelRegistryId) continue;
        const model = await prisma.modelRegistry.findUnique({
          where:  { id: row.modelRegistryId },
          select: { provider: true },
        });
        if (!model) continue;

        await upsertSpendingAnalytic(prisma, {
          workspaceId,
          date: targetDate,
          provider: model.provider,
          create: {
            workspaceId,
            date:          targetDate,
            provider:      model.provider,
            totalRequests: row._count.id,
            actualCostUsd: row._sum.actualCostUsd ?? 0,
            totalSavingsUsd: row._sum.savingsUsd ?? 0,
          },
          update: {
            totalRequests: row._count.id,
            actualCostUsd: row._sum.actualCostUsd ?? 0,
            totalSavingsUsd: row._sum.savingsUsd ?? 0,
          },
        });
      }

      // Update Prometheus cache hit-rate gauge
      if (totalRequests > 0) {
        gatewayMetrics.updateCacheHitRate(workspaceId, cacheHitRate * 100);
      }

      logger.info(
        {
          workspaceId,
          date: targetDate,
          totalRequests:   stats._count.id,
          actualCostUsd:   stats._sum.actualCostUsd,
          totalSavingsUsd: stats._sum.savingsUsd,
          cacheHitRate:    (cacheHitRate * 100).toFixed(1) + '%',
          perProviderRows: byProvider.length,
        },
        'Daily aggregation complete',
      );
    },
    { connection, concurrency: 2 },
  ));

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Daily aggregation job failed');
  });
}

// ── Cache maintenance worker ──────────────────────────────────
// Deletes expired cache entries hourly so the table doesn't grow unbounded.

function startCacheMaintenanceWorker(connection: BullMQConnection): void {
  const worker = trackWorker(new Worker(
    QUEUE_NAMES.CACHE_MAINTENANCE,
    async (job) => {
      const { prisma } = await import('@smartroute/database');

      const deleted = await prisma.cacheEntry.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });

      logger.info({ deletedCount: deleted.count, jobId: job.id }, 'Cache maintenance: expired entries removed');
    },
    { connection, concurrency: 1 },
  ));

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Cache maintenance job failed');
  });
}

// ── Budget notifications worker ───────────────────────────────
// Processes pending BudgetAlert records: marks them SENT and writes an audit log.
// In production this is where you'd fire emails/Slack webhooks/PagerDuty.

function startBudgetNotificationsWorker(connection: BullMQConnection): void {
  const worker = trackWorker(new Worker(
    QUEUE_NAMES.NOTIFICATIONS,
    async (job) => {
      if (job.name === 'api-key-expiry') {
        const { notifyExpiringApiKeys } = await import('../lib/apiKeyExpiry');
        const created = await notifyExpiringApiKeys();
        logger.info({ created, jobId: job.id }, 'API key expiry scan complete');
        return;
      }

      const { prisma } = await import('@smartroute/database');

      // Fetch all pending alerts (batch process up to 50 at a time)
      const pendingAlerts = await prisma.budgetAlert.findMany({
        where:   { status: 'PENDING' },
        include: { budget: { select: { name: true, limitUsd: true } } },
        take:    50,
        orderBy: { createdAt: 'asc' },
      });

      if (pendingAlerts.length === 0) {
        logger.debug({ jobId: job.id }, 'No pending budget alerts');
        return;
      }

      await Promise.allSettled(
        pendingAlerts.map(async (alert: typeof pendingAlerts[number]) => {
          const emoji = alert.severity === 'CRITICAL' ? '🚨' : '⚠️';
          logger.warn(
            {
              alertId:     alert.id,
              workspaceId: alert.workspaceId,
              budgetName:  alert.budget.name,
              severity:    alert.severity,
              message:     alert.message,
            },
            `${emoji} Budget alert: ${alert.message}`,
          );

          // Email workspace owners
          const { emailService } = await import('../services/email.service');
          const owners = await prisma.workspaceMember.findMany({
            where:   { workspaceId: alert.workspaceId, role: { in: ['OWNER', 'ADMIN'] } },
            include: { user: { select: { email: true } } },
          });
          const workspace = await prisma.workspace.findUnique({
            where:  { id: alert.workspaceId },
            select: { name: true },
          });

          await Promise.allSettled(
            owners.map((o) =>
              emailService.sendBudgetAlert(o.user.email, {
                workspaceName: workspace?.name ?? 'Workspace',
                severity:      alert.severity,
                message:       alert.message,
                spend:         alert.spendAtAlert,
                limit:         alert.budget.limitUsd,
              }),
            ),
          );

          // Mark as SENT + write audit entry transactionally
          await prisma.$transaction([
            prisma.budgetAlert.update({
              where: { id: alert.id },
              data:  { status: 'SENT', sentAt: new Date() },
            }),
            prisma.auditLog.create({
              data: {
                userId:      null,   // system-generated
                workspaceId: alert.workspaceId,
                action:      'BUDGET_ALERT_SENT',
                metadata: {
                  alertId:    alert.id,
                  budgetName: alert.budget.name,
                  limitUsd:   alert.budget.limitUsd,
                  severity:   alert.severity,
                  message:    alert.message,
                },
              },
            }),
          ]);
        }),
      );

      logger.info({ processed: pendingAlerts.length, jobId: job.id }, 'Budget alerts processed');
    },
    { connection, concurrency: 1 },
  ));

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Budget notifications job failed');
  });
}

// ===========================================================
// Recurring job schedulers
// ===========================================================

export async function scheduleRecurringJobs(): Promise<void> {
  const qs = getQueues();

  // Health checks every 2 minutes
  await qs[QUEUE_NAMES.HEALTH_CHECKS].upsertJobScheduler(
    'health-check-all',
    { every: 2 * 60 * 1000 },
    { name: 'health-check', data: {} },
  );

  // Budget alert notifications every 1 minute
  await qs[QUEUE_NAMES.NOTIFICATIONS].upsertJobScheduler(
    'process-budget-alerts',
    { every: 60 * 1000 },
    { name: 'notify', data: {} },
  );

  // API key expiry notifications once per day
  await qs[QUEUE_NAMES.NOTIFICATIONS].upsertJobScheduler(
    'api-key-expiry-scan',
    { every: 24 * 60 * 60 * 1000 },
    { name: 'api-key-expiry', data: {} },
  );

  // Cache cleanup every hour
  await qs[QUEUE_NAMES.CACHE_MAINTENANCE].upsertJobScheduler(
    'cache-cleanup',
    { every: 60 * 60 * 1000 },
    { name: 'cleanup', data: {} },
  );

  // Anomaly detection every 15 minutes
  await qs[QUEUE_NAMES.ANOMALY_DETECTION].upsertJobScheduler(
    'anomaly-scan',
    { every: 15 * 60 * 1000 },
    { name: 'scan', data: {} },
  );

  // Daily aggregation at 00:30 UTC
  await qs[QUEUE_NAMES.DAILY_AGGREGATIONS].upsertJobScheduler(
    'daily-aggregation-all',
    { every: 24 * 60 * 60 * 1000 },
    { name: 'aggregate-all', data: {} },
  );

  // Model pricing sync weekly
  await qs[QUEUE_NAMES.MODEL_PRICING].upsertJobScheduler(
    'model-pricing-sync',
    { every: 7 * 24 * 60 * 60 * 1000 },
    { name: 'sync-pricing', data: {} },
  );

  // Report queue depths to Prometheus every 30 seconds
  setInterval(() => reportQueueDepths().catch(() => {}), 30_000);

  logger.info('Recurring BullMQ jobs scheduled');
}

// ── Helper: enqueue analytics event from gateway service ─────

export async function enqueueAnalyticsEvent(data: {
  provider:        string;
  model:           string;
  workspaceId:     string;
  status:          'success' | 'error' | 'fallback' | 'cached';
  latencyMs:       number;
  actualCostUsd:   number;
  baselineCostUsd: number;
  cacheHit:        boolean;
}): Promise<void> {
  const qs = getQueues();
  await qs[QUEUE_NAMES.ANALYTICS].add('record-request', data, {
    removeOnComplete: true,
    attempts: 1,
  }).catch(() => {}); // fire-and-forget; never let this fail a request
}

// ── Helper: trigger daily aggregation for a workspace ────────

export async function triggerDailyAggregation(workspaceId: string, date?: string): Promise<void> {
  const qs = getQueues();
  await qs[QUEUE_NAMES.DAILY_AGGREGATIONS].add(
    'aggregate',
    { workspaceId, date },
    { jobId: `agg-${workspaceId}-${date ?? new Date().toISOString().slice(0, 10)}` },
  ).catch(() => {});
}

// ── Anomaly detection worker ──────────────────────────────────
// Scans all active workspaces for cost/volume/latency/error anomalies.

function startAnomalyDetectionWorker(connection: BullMQConnection): void {
  const worker = trackWorker(new Worker(
    QUEUE_NAMES.ANOMALY_DETECTION,
    async (job) => {
      const { anomalyDetector } = await import('../engines/anomalyDetector');
      logger.debug({ jobId: job.id }, 'Running anomaly detection scan');
      await anomalyDetector.runForAllWorkspaces();
    },
    { connection, concurrency: 1 },
  ));
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Anomaly detection job failed');
  });
}

// ── Model pricing sync worker ─────────────────────────────────
// Refreshes modelRegistry pricing from the canonical catalog.

function startModelPricingWorker(connection: BullMQConnection): void {
  const worker = trackWorker(new Worker(
    QUEUE_NAMES.MODEL_PRICING,
    async () => {
      const { prisma } = await import('@smartroute/database');
      const { MODEL_PRICING_CATALOG } = await import('@smartroute/shared');

      let updated = 0;
      for (const entry of MODEL_PRICING_CATALOG) {
        const result = await prisma.modelRegistry.updateMany({
          where: { provider: entry.provider as never, modelId: entry.modelId },
          data:  {
            inputCostPerMillion:  entry.inputCostPerMillion,
            outputCostPerMillion: entry.outputCostPerMillion,
          },
        });
        updated += result.count;
      }

      logger.info({ updated }, 'Model pricing sync completed');
    },
    { connection, concurrency: 1 },
  ));
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Model pricing sync failed');
  });
}

// ── Webhook worker ────────────────────────────────────────────
// Processes pending WebhookDelivery records. Each job carries a `deliveryId`.
// The service handles retries internally and updates the delivery record.

function startWebhookWorker(connection: BullMQConnection): void {
  const worker = trackWorker(new Worker(
    QUEUE_NAMES.WEBHOOKS,
    async (job) => {
      const { webhookService } = await import('../services/webhook.service');
      await webhookService.deliver(job.data.deliveryId as string);
    },
    { connection, concurrency: 10 },
  ));
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, deliveryId: job?.data?.deliveryId, err }, 'Webhook delivery job failed');
  });
}

// ── Helper: enqueue a webhook delivery job ───────────────────

export async function enqueueWebhookDelivery(deliveryId: string, delayMs = 0): Promise<void> {
  const qs = getQueues();
  await qs[QUEUE_NAMES.WEBHOOKS].add(
    'deliver',
    { deliveryId },
    {
      delay:    delayMs,
      attempts: 1,         // retry logic is handled by the service, not BullMQ
      jobId:    `wh-${deliveryId}`,
      removeOnComplete: true,
    },
  ).catch(() => {});
}

// ── Helper: dispatch webhook event ───────────────────────────

import type { WebhookEvent } from '../services/webhook.service';

export async function dispatchWebhookEvent(
  workspaceId: string,
  event:       WebhookEvent,
  data:        Record<string, unknown>,
): Promise<void> {
  try {
    const { webhookService } = await import('../services/webhook.service');
    const deliveryIds = await webhookService.dispatch(workspaceId, event, data);
    await Promise.all(deliveryIds.map((id) => enqueueWebhookDelivery(id)));
  } catch (err) {
    logger.error({ err, workspaceId, event }, 'Failed to dispatch webhook event');
  }
}
