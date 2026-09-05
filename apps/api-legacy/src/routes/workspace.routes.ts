import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { WorkspaceSlugSchema } from '@smartroute/shared';
import { requireAuth } from '../middleware/auth';
import { loadWorkspaceRole, canAdmin } from '../middleware/workspaceRole';
import { validate } from '../middleware/validate';
import { prisma } from '@smartroute/database';
import { AppError } from '../middleware/errorHandler';
import { getAuthUserId, getAuthWorkspaceId } from '../lib/workspaceContext';
import { auditSlugColumns } from '../lib/auditCsv';
import { enforceBudgetLimit } from '../lib/planEnforcement';
import { authService } from '../services/auth.service';
import { syncRateLimitRecord } from '../lib/syncRateLimit';
import { rateLimiterEngine } from '../engines/rateLimiter';

// Allowed routing strategies from model routing engine
const RoutingStrategyEnum = z.enum(['PRIORITY_BASED', 'COST_OPTIMIZED', 'LATENCY_OPTIMIZED', 'ROUND_ROBIN', 'WEIGHTED_RANDOM']);

const ProviderEnum = z.enum(['OPENAI', 'ANTHROPIC', 'GOOGLE', 'OLLAMA', 'COHERE', 'MISTRAL']);

const PatchWorkspaceSchema = z.object({
  name:                    z.string().min(1).max(60).optional(),
  slug:                    WorkspaceSlugSchema.optional(),
  defaultRoutingStrategy:  RoutingStrategyEnum.optional(),
  semanticCacheEnabled:    z.boolean().optional(),
  cacheThreshold:          z.number().min(0.5).max(1).optional(),
  allowedProviders:        z.array(ProviderEnum).optional(),
  // Per-workspace rate limit overrides (null = use plan default)
  requestsPerMinute:       z.number().int().positive().nullable().optional(),
  requestsPerDay:          z.number().int().positive().nullable().optional(),
  tokensPerMinute:         z.number().int().positive().nullable().optional(),
});

export const workspaceRouter = Router();

workspaceRouter.use(requireAuth, loadWorkspaceRole);

workspaceRouter.post(
  '/',
  validate(z.object({ name: z.string().min(2).max(60) })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await authService.createWorkspace(getAuthUserId(req), req.body.name);
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

workspaceRouter.get('/current', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: req.user!.workspaceId },
      include: {
        members: { include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } } },
        budgets: { where: { isActive: true } },
        _count: { select: { requests: true, apiKeys: true } },
      },
    });

    if (!workspace) throw AppError.notFound('Workspace not found');
    res.status(200).json({ success: true, data: workspace });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /current — update workspace settings ────────────────
workspaceRouter.patch(
  '/current',
  canAdmin,
  validate(PatchWorkspaceSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = getAuthWorkspaceId(req);
      const userId = getAuthUserId(req);
      const {
        name,
        slug,
        defaultRoutingStrategy,
        semanticCacheEnabled,
        cacheThreshold,
        allowedProviders,
        requestsPerMinute,
        requestsPerDay,
        tokensPerMinute,
      } = req.body as z.infer<typeof PatchWorkspaceSchema>;

      const current = await prisma.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { slug: true, name: true },
      });

      if (slug !== undefined) {
        const taken = await prisma.workspace.findFirst({
          where: { slug, id: { not: workspaceId } },
          select: { id: true },
        });
        if (taken) throw AppError.conflict('Workspace slug already taken');
      }

      const updated = await prisma.workspace.update({
        where: { id: workspaceId },
        data: {
          ...(name                   !== undefined ? { name }                   : {}),
          ...(slug                   !== undefined ? { slug }                   : {}),
          ...(defaultRoutingStrategy !== undefined ? { defaultRoutingStrategy } : {}),
          ...(semanticCacheEnabled   !== undefined ? { semanticCacheEnabled }   : {}),
          ...(cacheThreshold         !== undefined ? { cacheThreshold }         : {}),
          ...(allowedProviders       !== undefined ? { allowedProviders }       : {}),
          ...(requestsPerMinute      !== undefined ? { requestsPerMinute }      : {}),
          ...(requestsPerDay         !== undefined ? { requestsPerDay }         : {}),
          ...(tokensPerMinute        !== undefined ? { tokensPerMinute }        : {}),
        },
      });

      const slugChanged = slug !== undefined && slug !== current.slug;
      const auditMetadata: Record<string, unknown> = { ...req.body };
      if (slugChanged) {
        auditMetadata.previousSlug = current.slug;
        auditMetadata.newSlug = slug;
      }

      // Audit log
      await prisma.auditLog.create({
        data: {
          userId,
          workspaceId,
          action:      'SETTINGS_UPDATED',
          metadata:    auditMetadata,
        },
      });

      if (slugChanged) {
        await prisma.notification.create({
          data: {
            workspaceId,
            type:  'WORKSPACE_SLUG_CHANGED',
            title: 'Workspace slug updated',
            body:  `Slug changed from @${current.slug} to @${slug}. Update IdP ACS URLs if SSO is configured.`,
            metadata: { previousSlug: current.slug, newSlug: slug },
          },
        });
      }

      await syncRateLimitRecord(workspaceId);

      res.status(200).json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /current/budgets — create a budget ───────────────────
const CreateBudgetSchema = z.object({
  name:        z.string().min(1).max(80),
  limitUsd:    z.number().positive(),
  period:      z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY', 'TOTAL']),
  alertAt80:   z.boolean().default(true),
  alertAt90:   z.boolean().default(true),
  blockAt100:  z.boolean().default(true),
});

workspaceRouter.post(
  '/current/budgets',
  canAdmin,
  validate(CreateBudgetSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = getAuthWorkspaceId(req);
      const { name, limitUsd, period, alertAt80, alertAt90, blockAt100 } =
        req.body as z.infer<typeof CreateBudgetSchema>;

      await enforceBudgetLimit(workspaceId, limitUsd);

      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const budget = await prisma.budget.create({
        data: {
          workspaceId,
          name,
          limitUsd,
          period:        period as never,
          periodStartAt: start,
          periodEndAt:   end,
          alertAt80,
          alertAt90,
          blockAt100,
        },
      });

      res.status(201).json({ success: true, data: budget });
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /current/budgets ──────────────────────────────────────
workspaceRouter.get('/current/budgets', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const budgets = await prisma.budget.findMany({
      where: { workspaceId: req.user!.workspaceId, isActive: true },
      include: {
        budgetAlerts: { where: { status: { in: ['PENDING', 'SENT'] } }, orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });

    res.status(200).json({ success: true, data: budgets });
  } catch (err) {
    next(err);
  }
});

/** Read-only peek at current Redis rate-limit counters (no increment). */
workspaceRouter.get('/current/rate-limits', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = getAuthWorkspaceId(req);
    const status = await rateLimiterEngine.getStatus(workspaceId);
    res.status(200).json({ success: true, data: status });
  } catch (err) {
    next(err);
  }
});

workspaceRouter.get('/current/health', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const latestHealthChecks = await prisma.providerHealth.findMany({
      where: {
        checkedAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
      },
      include: { model: { select: { provider: true, modelId: true } } },
      orderBy: { checkedAt: 'desc' },
      distinct: ['modelRegistryId'],
    });

    res.status(200).json({ success: true, data: latestHealthChecks });
  } catch (err) {
    next(err);
  }
});

// ── GET /current/audit-logs — paginated audit log ─────────────
workspaceRouter.get('/current/audit-logs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = getAuthWorkspaceId(req);
    const page  = Math.max(1, parseInt(String(req.query.page  ?? '1'),  10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '30'), 10)));
    const skip  = (page - 1) * limit;

    const [data, total] = await Promise.all([
      prisma.auditLog.findMany({
        where:   { workspaceId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
      prisma.auditLog.count({ where: { workspaceId } }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        data,
        pagination: {
          page, limit, total,
          totalPages: Math.ceil(total / limit),
          hasNext: skip + limit < total,
          hasPrev: page > 1,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

/** GET /current/audit-logs/export — CSV export for compliance */
workspaceRouter.get('/current/audit-logs/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = getAuthWorkspaceId(req);
    const format = (req.query.format as string) === 'csv' ? 'csv' : 'json';
    const limit = Math.min(parseInt(String(req.query.limit ?? '5000'), 10) || 5000, 10_000);
    const from = req.query.from ? new Date(req.query.from as string) : new Date(Date.now() - 30 * 86_400_000);
    const to = req.query.to ? new Date(req.query.to as string) : new Date();

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      res.status(400).json({ success: false, error: { code: 'INVALID_DATE', message: 'Invalid from/to date' } });
      return;
    }

    const rows = await prisma.auditLog.findMany({
      where: { workspaceId, createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { user: { select: { name: true, email: true } } },
    });

    if (format === 'csv') {
      const cols = [
        'id', 'action', 'resourceType', 'resourceId', 'userName', 'userEmail',
        'ipAddress', 'previousSlug', 'newSlug', 'metadata', 'createdAt',
      ];

      const escape = (v: unknown): string => {
        const s = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '');
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      };

      const lines = rows.map((r) => {
        const { previousSlug, newSlug } = auditSlugColumns(r.metadata);
        return [
          r.id,
          r.action,
          r.resourceType ?? '',
          r.resourceId ?? '',
          r.user?.name ?? '',
          r.user?.email ?? '',
          r.ipAddress ?? '',
          previousSlug,
          newSlug,
          r.metadata ? JSON.stringify(r.metadata) : '',
          r.createdAt.toISOString(),
        ].map(escape).join(',');
      });

      const csv = [cols.join(','), ...lines].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="smartroute-audit-${from.toISOString().slice(0, 10)}.csv"`,
      );
      res.send(csv);
      return;
    }

    res.status(200).json({
      success: true,
      data: rows,
      meta: { count: rows.length, from: from.toISOString(), to: to.toISOString(), limit },
    });
  } catch (err) {
    next(err);
  }
});
