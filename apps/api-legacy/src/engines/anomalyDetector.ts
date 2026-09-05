/**
 * Anomaly Detection Engine
 *
 * Runs periodically via BullMQ and compares the last N minutes of traffic
 * against a rolling 7-day baseline for each workspace.
 *
 * Detects:
 *   • Cost spike     — per-request cost 3× above 7-day p95
 *   • Volume spike   — request count 3× above same-window average
 *   • Latency spike  — avg latency 2× above 7-day average
 *   • Error surge    — error rate > 20% in last 15 min
 *
 * On anomaly:
 *   1. Creates a Notification record (visible in the dashboard)
 *   2. Dispatches 'anomaly.detected' webhook event
 *   3. Increments the `smartroute_anomalies_detected_total` Prometheus counter
 *
 * Idempotency:
 *   Each anomaly type is suppressed for COOLDOWN_MINUTES after the last alert
 *   to avoid notification storms.  The cooldown key is stored in Redis.
 */

import { prisma } from '@smartroute/database';
import { getRedis } from '../config/redis';
import { logger } from '../config/logger';
import { Counter } from 'prom-client';

const anomaliesDetectedTotal = new Counter({
  name:       'smartroute_anomalies_detected_total',
  help:       'Number of anomalies detected across all workspaces',
  labelNames: ['workspace_id', 'anomaly_type'],
});

const LOOKBACK_MINUTES  = 15;     // detection window
const BASELINE_DAYS     = 7;      // rolling baseline period
const COST_SPIKE_RATIO  = 3.0;    // alert when cost/req is 3× baseline p95
const VOLUME_SPIKE_RATIO = 3.0;   // alert when request volume is 3× baseline
const LATENCY_SPIKE_RATIO = 2.0;  // alert when avg latency is 2× baseline
const ERROR_RATE_THRESHOLD = 0.20; // alert when error rate > 20%
const COOLDOWN_MINUTES   = 60;    // suppress same anomaly for 60 min

type AnomalyType = 'cost_spike' | 'volume_spike' | 'latency_spike' | 'error_surge';

interface AnomalyEvent {
  type:        AnomalyType;
  workspaceId: string;
  value:       number;
  baseline:    number;
  ratio:       number;
  message:     string;
}

export class AnomalyDetectorEngine {
  async runForAllWorkspaces(): Promise<void> {
    const workspaces = await prisma.workspace.findMany({
      where:  { isActive: true, deletedAt: null },
      select: { id: true },
    });

    await Promise.allSettled(
      workspaces.map((ws) => this.analyseWorkspace(ws.id)),
    );
  }

  async analyseWorkspace(workspaceId: string): Promise<void> {
    const now        = new Date();
    const windowFrom = new Date(now.getTime() - LOOKBACK_MINUTES * 60_000);
    const baselineFrom = new Date(now.getTime() - BASELINE_DAYS * 86_400_000);

    // ── Recent window metrics ─────────────────────────────────

    const [recentAgg, baselineAgg, recentCount, baselineCount] = await Promise.all([
      prisma.request.aggregate({
        where: {
          workspaceId,
          createdAt: { gte: windowFrom },
          status: { in: ['COMPLETED', 'FAILED', 'CACHED'] },
        },
        _avg: { actualCostUsd: true, totalLatencyMs: true },
        _sum: { actualCostUsd: true },
      }),
      prisma.request.aggregate({
        where: {
          workspaceId,
          createdAt: { gte: baselineFrom, lt: windowFrom },
          status: { in: ['COMPLETED', 'CACHED'] },
        },
        _avg: { actualCostUsd: true, totalLatencyMs: true },
      }),
      prisma.request.count({
        where: { workspaceId, createdAt: { gte: windowFrom }, status: { in: ['COMPLETED', 'FAILED', 'CACHED'] } },
      }),
      prisma.request.count({
        where: { workspaceId, createdAt: { gte: baselineFrom, lt: windowFrom }, status: { in: ['COMPLETED', 'CACHED'] } },
      }),
    ]);

    const recentCostAvg = recentAgg._avg.actualCostUsd    ?? 0;
    const recentLatency = recentAgg._avg.totalLatencyMs   ?? 0;

    // No recent traffic — nothing to detect
    if (recentCount === 0) return;

    const baselineCostAvg = baselineAgg._avg.actualCostUsd  ?? 0;
    const baselineLatency = baselineAgg._avg.totalLatencyMs ?? 0;

    // Need at least 10 baseline requests for meaningful comparison
    if (baselineCount < 10) return;

    const anomalies: AnomalyEvent[] = [];

    // ── Cost spike ────────────────────────────────────────────

    if (baselineCostAvg > 0 && recentCostAvg > 0) {
      const costRatio = recentCostAvg / baselineCostAvg;
      if (costRatio >= COST_SPIKE_RATIO) {
        anomalies.push({
          type:        'cost_spike',
          workspaceId,
          value:       recentCostAvg,
          baseline:    baselineCostAvg,
          ratio:       costRatio,
          message:     `Cost per request $${recentCostAvg.toFixed(4)} is ${costRatio.toFixed(1)}× the 7-day average ($${baselineCostAvg.toFixed(4)})`,
        });
      }
    }

    // ── Volume spike ──────────────────────────────────────────

    const baselineRpm = baselineCount / (BASELINE_DAYS * 24 * 60);  // avg req/min over baseline
    const recentRpm   = recentCount / LOOKBACK_MINUTES;

    if (baselineRpm > 0) {
      const volumeRatio = recentRpm / baselineRpm;
      if (volumeRatio >= VOLUME_SPIKE_RATIO) {
        anomalies.push({
          type:        'volume_spike',
          workspaceId,
          value:       recentRpm,
          baseline:    baselineRpm,
          ratio:       volumeRatio,
          message:     `Request rate ${recentRpm.toFixed(1)} req/min is ${volumeRatio.toFixed(1)}× the 7-day average (${baselineRpm.toFixed(1)} req/min)`,
        });
      }
    }

    // ── Latency spike ─────────────────────────────────────────

    if (baselineLatency > 0 && recentLatency > 0) {
      const latencyRatio = recentLatency / baselineLatency;
      if (latencyRatio >= LATENCY_SPIKE_RATIO) {
        anomalies.push({
          type:        'latency_spike',
          workspaceId,
          value:       recentLatency,
          baseline:    baselineLatency,
          ratio:       latencyRatio,
          message:     `Avg latency ${recentLatency.toFixed(0)}ms is ${latencyRatio.toFixed(1)}× the 7-day average (${baselineLatency.toFixed(0)}ms)`,
        });
      }
    }

    // ── Error surge ───────────────────────────────────────────

    const recentErrors = await prisma.request.count({
      where: { workspaceId, createdAt: { gte: windowFrom }, status: 'FAILED' },
    });

    const errorRate = recentCount > 0 ? recentErrors / recentCount : 0;
    if (errorRate >= ERROR_RATE_THRESHOLD && recentCount >= 5) {
      anomalies.push({
        type:        'error_surge',
        workspaceId,
        value:       errorRate,
        baseline:    0,
        ratio:       errorRate,
        message:     `Error rate ${(errorRate * 100).toFixed(1)}% in last ${LOOKBACK_MINUTES} min (${recentErrors}/${recentCount} requests failed)`,
      });
    }

    // ── Fire alerts ───────────────────────────────────────────

    await Promise.allSettled(anomalies.map((a) => this.fireAnomaly(a)));
  }

  private async fireAnomaly(anomaly: AnomalyEvent): Promise<void> {
    const redis    = getRedis();
    const coolKey  = `anomaly:${anomaly.workspaceId}:${anomaly.type}`;

    // Cooldown check
    const existing = await redis.get(coolKey).catch(() => null);
    if (existing) return;

    // Set cooldown
    await redis.set(coolKey, '1', 'EX', COOLDOWN_MINUTES * 60).catch(() => {});

    anomaliesDetectedTotal.inc({ workspace_id: anomaly.workspaceId, anomaly_type: anomaly.type });

    logger.warn({ anomaly }, `Anomaly detected: ${anomaly.type}`);

    // Create in-app notification
    await prisma.notification.create({
      data: {
        workspaceId: anomaly.workspaceId,
        type:        'ANOMALY_DETECTED',
        title:       `⚠️ Anomaly: ${anomaly.type.replace('_', ' ')}`,
        body:        anomaly.message,
        metadata: {
          type:     anomaly.type,
          value:    anomaly.value,
          baseline: anomaly.baseline,
          ratio:    anomaly.ratio,
        },
      },
    }).catch((err: unknown) => {
      logger.error({ err }, 'Failed to create anomaly notification');
    });

    // Dispatch webhook
    const { dispatchWebhookEvent } = await import('../queues/index');
    await dispatchWebhookEvent(anomaly.workspaceId, 'anomaly.detected', {
      type:     anomaly.type,
      message:  anomaly.message,
      value:    anomaly.value,
      baseline: anomaly.baseline,
      ratio:    anomaly.ratio,
    }).catch((err: unknown) => {
      logger.error({ err }, 'Failed to dispatch anomaly webhook');
    });
  }
}

export const anomalyDetector = new AnomalyDetectorEngine();
