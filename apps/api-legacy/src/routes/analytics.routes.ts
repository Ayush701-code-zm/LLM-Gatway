import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../middleware/auth';
import { loadWorkspaceRole, canWrite } from '../middleware/workspaceRole';
import { AppError } from '../middleware/errorHandler';
import { prisma } from '@smartroute/database';
import { gatewayService } from '../services/gateway.service';
import type { ApiKeyContext } from '../types';

export const analyticsRouter = Router();

analyticsRouter.use(requireAuth);
analyticsRouter.use(loadWorkspaceRole);

analyticsRouter.get('/overview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [totalRequests, totalSpend, cacheStats, avgLatency, fallbackCount, retryCount, cacheSavings] =
      await Promise.all([
        prisma.request.count({ where: { workspaceId, createdAt: { gte: since } } }),

        prisma.request.aggregate({
          where: { workspaceId, createdAt: { gte: since } },
          _sum: { actualCostUsd: true, savingsUsd: true },
        }),

        prisma.request.groupBy({
          by: ['cacheHit'],
          where: { workspaceId, createdAt: { gte: since } },
          _count: true,
        }),

        prisma.request.aggregate({
          where: { workspaceId, createdAt: { gte: since }, status: 'COMPLETED' },
          _avg: { totalLatencyMs: true },
        }),

        prisma.request.count({
          where: { workspaceId, createdAt: { gte: since }, fallbackUsed: true },
        }),

        prisma.request.count({
          where: { workspaceId, createdAt: { gte: since }, retryCount: { gt: 0 } },
        }),

        prisma.request.aggregate({
          where: { workspaceId, createdAt: { gte: since }, cacheHit: true },
          _sum: { savingsUsd: true },
        }),
      ]);

    const successCount = await prisma.request.count({
      where: {
        workspaceId,
        createdAt: { gte: since },
        status: { in: ['COMPLETED', 'CACHED'] },
      },
    });

    const totalCost = totalSpend._sum.actualCostUsd ?? 0;
    const totalSavings = totalSpend._sum.savingsUsd ?? 0;
    const cacheHits = cacheStats.find((s: { cacheHit: boolean; _count: number }) => s.cacheHit)?._count ?? 0;
    const cacheMisses = cacheStats.find((s: { cacheHit: boolean; _count: number }) => !s.cacheHit)?._count ?? 0;
    const cacheHitRate = totalRequests > 0 ? (cacheHits / totalRequests) * 100 : 0;
    const successRate = totalRequests > 0 ? (successCount / totalRequests) * 100 : 100;
    const fallbackRate = totalRequests > 0 ? (fallbackCount / totalRequests) * 100 : 0;
    const retryRate = totalRequests > 0 ? (retryCount / totalRequests) * 100 : 0;

    res.status(200).json({
      success: true,
      data: {
        totalRequests,
        totalCostUsd: totalCost,
        totalSavingsUsd: totalSavings,
        savingsPercent: totalCost + totalSavings > 0
          ? ((totalSavings / (totalCost + totalSavings)) * 100).toFixed(1)
          : 0,
        cacheHitRate: cacheHitRate.toFixed(1),
        cacheHits,
        cacheMisses,
        cacheSavingsUsd: cacheSavings._sum.savingsUsd ?? 0,
        avgLatencyMs: Math.round(avgLatency._avg.totalLatencyMs ?? 0),
        successRate: successRate.toFixed(1),
        fallbackRate: fallbackRate.toFixed(1),
        retryRate: retryRate.toFixed(1),
        period: '30d',
      },
    });
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get('/spend/daily', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const days = parseInt(String(req.query.days ?? '30'));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const daily = await prisma.spendingAnalytic.findMany({
      where: { workspaceId, date: { gte: since } },
      orderBy: { date: 'asc' },
    });

    res.status(200).json({ success: true, data: daily });
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get('/requests', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const page = parseInt(String(req.query.page ?? '1'));
    const limit = Math.min(parseInt(String(req.query.limit ?? '20')), 100);
    const skip = (page - 1) * limit;

    const [requests, total] = await Promise.all([
      prisma.request.findMany({
        where: { workspaceId },
        select: {
          id: true,
          traceId: true,
          status: true,
          requestedModel: true,
          cacheHit: true,
          complexityLevel: true,
          inputTokens: true,
          outputTokens: true,
          actualCostUsd: true,
          savingsUsd: true,
          totalLatencyMs: true,
          fallbackUsed: true,
          retryCount: true,
          createdAt: true,
          model: { select: { provider: true, modelId: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.request.count({ where: { workspaceId } }),
    ]);

    res.status(200).json({
      success: true,
      data: requests,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    });
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get('/requests/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const request = await prisma.request.findFirst({
      where: { id: req.params.id, workspaceId },
      select: {
        id: true,
        traceId: true,
        status: true,
        prompt: true,
        systemPrompt: true,
        response: true,
        requestedModel: true,
        cacheHit: true,
        complexityLevel: true,
        inputTokens: true,
        outputTokens: true,
        actualCostUsd: true,
        savingsUsd: true,
        totalLatencyMs: true,
        fallbackUsed: true,
        retryCount: true,
        finishReason: true,
        createdAt: true,
        model: { select: { provider: true, modelId: true } },
      },
    });

    if (!request) {
      return next(AppError.notFound('Request not found'));
    }

    res.status(200).json({ success: true, data: request });
  } catch (err) {
    next(err);
  }
});

analyticsRouter.post(
  '/requests/:id/replay',
  canWrite,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.user!.workspaceId;
      const original = await prisma.request.findFirst({
        where: { id: req.params.id, workspaceId },
        select: {
          id: true,
          apiKeyId: true,
          prompt: true,
          systemPrompt: true,
          requestedModel: true,
        },
      });

      if (!original) {
        return next(AppError.notFound('Request not found'));
      }

      let apiKeyRecord = await prisma.apiKey.findFirst({
        where: { id: original.apiKeyId, workspaceId, status: 'ACTIVE' },
        select: { id: true, workspaceId: true, scopes: true, expiresAt: true },
      });

      if (!apiKeyRecord || (apiKeyRecord.expiresAt && apiKeyRecord.expiresAt < new Date())) {
        apiKeyRecord = await prisma.apiKey.findFirst({
          where: { workspaceId, status: 'ACTIVE' },
          orderBy: { createdAt: 'asc' },
          select: { id: true, workspaceId: true, scopes: true, expiresAt: true },
        });
      }

      if (!apiKeyRecord) {
        return next(AppError.badRequest('No active API key in this workspace. Create one to replay requests.'));
      }

      const apiKey: ApiKeyContext = {
        id: apiKeyRecord.id,
        workspaceId: apiKeyRecord.workspaceId,
        scopes: apiKeyRecord.scopes,
      };

      const requestId = uuidv4();
      const traceId = uuidv4();

      const response = await gatewayService.processChat(
        {
          message: original.prompt,
          systemPrompt: original.systemPrompt ?? undefined,
          model: original.requestedModel ?? 'auto',
          stream: false,
        },
        { requestId, traceId, apiKey },
      );

      res.status(200).json({
        success: true,
        data: {
          replayedFromId: original.id,
          response,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

analyticsRouter.get('/providers', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user!.workspaceId;

    const providerStats = await prisma.providerLog.groupBy({
      by: ['modelRegistryId'],
      where: { request: { workspaceId } },
      _count: { id: true },
      _sum: { costUsd: true, latencyMs: true },
      _avg: { latencyMs: true },
    });

    res.status(200).json({ success: true, data: providerStats });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/analytics/reliability
 *
 * Fallback, retry, error, and circuit-breaker stats for the workspace.
 */
analyticsRouter.get('/reliability', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const days = Math.min(parseInt(String(req.query.days ?? '30'), 10) || 30, 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [
      totalRequests,
      fallbackCount,
      retryCount,
      failedCount,
      circuitBreakerOpens,
      fallbackByProvider,
      recentFallbacks,
      recentCircuitEvents,
    ] = await Promise.all([
      prisma.request.count({ where: { workspaceId, createdAt: { gte: since } } }),

      prisma.request.count({
        where: { workspaceId, createdAt: { gte: since }, fallbackUsed: true },
      }),

      prisma.request.count({
        where: { workspaceId, createdAt: { gte: since }, retryCount: { gt: 0 } },
      }),

      prisma.request.count({
        where: { workspaceId, createdAt: { gte: since }, status: 'FAILED' },
      }),

      prisma.circuitBreakerEvent.count({
        where: { createdAt: { gte: since }, toState: 'OPEN' },
      }),

      prisma.fallbackEvent.groupBy({
        by: ['failedProvider', 'fallbackProvider'],
        where: { request: { workspaceId, createdAt: { gte: since } } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),

      prisma.fallbackEvent.findMany({
        where: { request: { workspaceId, createdAt: { gte: since } } },
        orderBy: { createdAt: 'desc' },
        take: 15,
        include: {
          request: { select: { id: true, traceId: true, requestedModel: true } },
        },
      }),

      prisma.circuitBreakerEvent.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 15,
      }),
    ]);

    const pct = (n: number) => (totalRequests > 0 ? ((n / totalRequests) * 100).toFixed(1) : '0.0');

    res.status(200).json({
      success: true,
      data: {
        period: `${days}d`,
        totalRequests,
        fallbackCount,
        fallbackRate: pct(fallbackCount),
        retryCount,
        retryRate: pct(retryCount),
        failedCount,
        errorRate: pct(failedCount),
        circuitBreakerOpens,
        fallbackByProvider: fallbackByProvider.map((row) => ({
          failedProvider: row.failedProvider,
          fallbackProvider: row.fallbackProvider,
          count: row._count.id,
        })),
        recentFallbacks,
        recentCircuitEvents,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/analytics/usage
 *
 * Aggregates usage_metrics time-series for dashboard charts.
 */
analyticsRouter.get('/usage', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const days = Math.min(parseInt(String(req.query.days ?? '30'), 10) || 30, 90);
    const since = new Date(Date.now() - days * 86_400_000);

    const rows = await prisma.usageMetric.findMany({
      where: { workspaceId, recordedAt: { gte: since } },
      select: { metricName: true, metricValue: true, recordedAt: true },
      orderBy: { recordedAt: 'asc' },
    });

    const daily: Record<string, { cost: number; requests: number; latencySum: number; latencyCount: number }> = {};

    for (const row of rows) {
      const day = row.recordedAt.toISOString().slice(0, 10);
      daily[day] ??= { cost: 0, requests: 0, latencySum: 0, latencyCount: 0 };

      if (row.metricName === 'request_cost_usd') daily[day].cost += row.metricValue;
      if (row.metricName === 'request_count') daily[day].requests += row.metricValue;
      if (row.metricName === 'request_latency_ms') {
        daily[day].latencySum += row.metricValue;
        daily[day].latencyCount += 1;
      }
    }

    const series = Object.entries(daily)
      .map(([date, v]) => ({
        date,
        costUsd: v.cost,
        requests: Math.round(v.requests),
        avgLatencyMs: v.latencyCount > 0 ? Math.round(v.latencySum / v.latencyCount) : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.status(200).json({
      success: true,
      data: { period: `${days}d`, series },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/analytics/anomalies
 *
 * Returns ANOMALY_DETECTED notifications for the workspace.
 */
analyticsRouter.get('/anomalies', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const days = Math.min(parseInt(String(req.query.days ?? '30'), 10) || 30, 90);
    const since = new Date(Date.now() - days * 86_400_000);

    const anomalies = await prisma.notification.findMany({
      where: {
        workspaceId,
        type: 'ANOMALY_DETECTED',
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.status(200).json({
      success: true,
      data: {
        period: `${days}d`,
        count: anomalies.length,
        anomalies,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/analytics/export
 */
analyticsRouter.get('/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const format  = (req.query.format as string) === 'csv' ? 'csv' : 'json';
    const limit   = Math.min(parseInt(req.query.limit as string) || 5000, 10_000);
    const from    = req.query.from ? new Date(req.query.from as string) : new Date(Date.now() - 30 * 86_400_000);
    const to      = req.query.to   ? new Date(req.query.to   as string) : new Date();

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      res.status(400).json({ success: false, error: { code: 'INVALID_DATE', message: 'Invalid from/to date' } });
      return;
    }

    const rows = await prisma.request.findMany({
      where: {
        workspaceId,
        createdAt: { gte: from, lte: to },
      },
      select: {
        id:               true,
        traceId:          true,
        createdAt:        true,
        requestedModel:   true,
        status:           true,
        inputTokens:      true,
        outputTokens:     true,
        totalTokens:      true,
        actualCostUsd:    true,
        baselineCostUsd:  true,
        savingsUsd:       true,
        totalLatencyMs:   true,
        complexityLevel:  true,
        cacheHit:         true,
        fallbackUsed:     true,
        retryCount:       true,
        finishReason:     true,
      },
      orderBy: { createdAt: 'desc' },
      take:    limit,
    });

    if (format === 'csv') {
      const cols = [
        'id', 'traceId', 'createdAt', 'requestedModel', 'status',
        'inputTokens', 'outputTokens', 'totalTokens',
        'actualCostUsd', 'baselineCostUsd', 'savingsUsd',
        'totalLatencyMs', 'complexityLevel',
        'cacheHit', 'fallbackUsed', 'retryCount', 'finishReason',
      ];

      const escape = (v: unknown): string => {
        const s = String(v ?? '');
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      };

      const header = cols.join(',');
      const lines  = rows.map((r) =>
        cols.map((c) => escape(r[c as keyof typeof r])).join(','),
      );

      const csv = [header, ...lines].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="smartroute-requests-${from.toISOString().slice(0, 10)}-${to.toISOString().slice(0, 10)}.csv"`,
      );
      res.send(csv);
    } else {
      res.status(200).json({
        success: true,
        data: rows,
        meta: {
          count:     rows.length,
          from:      from.toISOString(),
          to:        to.toISOString(),
          limit,
          truncated: rows.length === limit,
        },
      });
    }
  } catch (err) {
    next(err);
  }
});
