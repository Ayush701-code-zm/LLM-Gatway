import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { loadWorkspaceRole, canAdmin } from '../middleware/workspaceRole';
import { prisma } from '@smartroute/database';

export const systemRouter = Router();

systemRouter.use(requireAuth, loadWorkspaceRole, canAdmin);

/** Latest infrastructure health snapshots (database, redis, api). */
systemRouter.get('/health', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const checks = await prisma.healthCheck.findMany({
      where: { checkedAt: { gte: since } },
      orderBy: { checkedAt: 'desc' },
      take: 100,
    });

    const latestByService = new Map<string, typeof checks[number]>();
    for (const check of checks) {
      if (!latestByService.has(check.service)) {
        latestByService.set(check.service, check);
      }
    }

    res.status(200).json({
      success: true,
      data: Array.from(latestByService.values()),
    });
  } catch (err) {
    next(err);
  }
});
