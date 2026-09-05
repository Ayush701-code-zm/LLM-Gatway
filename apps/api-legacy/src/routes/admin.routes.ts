import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireSuperAdmin } from '../middleware/superAdmin';
import { validate } from '../middleware/validate';
import { prisma } from '@smartroute/database';
import { AppError } from '../middleware/errorHandler';
import { syncRateLimitRecord } from '../lib/syncRateLimit';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireSuperAdmin);

adminRouter.get('/overview', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [users, workspaces, requestsToday, activeWorkspaces] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.workspace.count({ where: { deletedAt: null } }),
      prisma.request.count({ where: { createdAt: { gte: since } } }),
      prisma.workspace.count({ where: { deletedAt: null, isActive: true } }),
    ]);

    res.status(200).json({
      success: true,
      data: { users, workspaces, activeWorkspaces, requestsToday },
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/workspaces', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10)));
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      prisma.workspace.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          name: true,
          slug: true,
          plan: true,
          isActive: true,
          createdAt: true,
          _count: { select: { members: true, requests: true } },
        },
      }),
      prisma.workspace.count({ where: { deletedAt: null } }),
    ]);

    res.status(200).json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: skip + limit < total,
        hasPrev: page > 1,
      },
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch(
  '/workspaces/:id',
  validate(
    z.object({
      plan: z.enum(['FREE', 'PRO', 'ENTERPRISE']).optional(),
      isActive: z.boolean().optional(),
    }),
  ),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspace = await prisma.workspace.findFirst({
        where: { id: req.params.id, deletedAt: null },
      });
      if (!workspace) return next(AppError.notFound('Workspace not found'));

      const updated = await prisma.workspace.update({
        where: { id: workspace.id },
        data: {
          ...(req.body.plan !== undefined ? { plan: req.body.plan } : {}),
          ...(req.body.isActive !== undefined ? { isActive: req.body.isActive } : {}),
        },
      });

      if (req.body.plan !== undefined) {
        await syncRateLimitRecord(workspace.id);
      }

      res.status(200).json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.get('/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10)));
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      prisma.user.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          emailVerified: true,
          createdAt: true,
          lastLoginAt: true,
          _count: { select: { workspaceMemberships: true } },
        },
      }),
      prisma.user.count({ where: { deletedAt: null } }),
    ]);

    res.status(200).json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: skip + limit < total,
        hasPrev: page > 1,
      },
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch(
  '/users/:id',
  validate(z.object({ role: z.enum(['SUPER_ADMIN', 'USER']) })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await prisma.user.findFirst({
        where: { id: req.params.id, deletedAt: null },
      });
      if (!user) return next(AppError.notFound('User not found'));

      const updated = await prisma.user.update({
        where: { id: user.id },
        data: { role: req.body.role },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          emailVerified: true,
        },
      });

      res.status(200).json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
);
