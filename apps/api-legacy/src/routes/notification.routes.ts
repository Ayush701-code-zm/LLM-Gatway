/**
 * Notification routes — in-app alerts for budget, anomalies, provider status.
 *
 * GET   /api/v1/notifications              — list (paginated, unread filter)
 * PATCH /api/v1/notifications/:id/read     — mark single as read
 * POST  /api/v1/notifications/read-all     — mark all workspace notifications read
 * GET   /api/v1/notifications/unread-count — badge count for dashboard
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { prisma } from '@smartroute/database';
import { AppError } from '../middleware/errorHandler';
import { getAuthWorkspaceId, getAuthUserId } from '../lib/workspaceContext';

export const notificationRouter = Router();

notificationRouter.use(requireAuth);

notificationRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = getAuthWorkspaceId(req);
    const page   = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
    const limit  = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '30'), 10)));
    const unread = req.query.unread === 'true';
    const skip   = (page - 1) * limit;

    const where = {
      workspaceId,
      ...(unread ? { readAt: null } : {}),
    };

    const [data, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.notification.count({ where }),
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

notificationRouter.get('/unread-count', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = getAuthWorkspaceId(req);
    const count = await prisma.notification.count({
      where: { workspaceId, readAt: null },
    });
    res.status(200).json({ success: true, data: { count } });
  } catch (err) {
    next(err);
  }
});

notificationRouter.patch('/:id/read', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = getAuthWorkspaceId(req);
    const id = String(req.params.id);

    const existing = await prisma.notification.findFirst({ where: { id, workspaceId } });
    if (!existing) throw AppError.notFound(`Notification ${id} not found`);

    const updated = await prisma.notification.update({
      where: { id },
      data:  { readAt: new Date() },
    });

    res.status(200).json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

notificationRouter.post('/read-all', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = getAuthWorkspaceId(req);
    const userId = getAuthUserId(req);

    const result = await prisma.notification.updateMany({
      where: { workspaceId, readAt: null },
      data:  { readAt: new Date() },
    });

    await prisma.auditLog.create({
      data: {
        workspaceId,
        userId,
        action:       'SETTINGS_UPDATED',
        resourceType: 'Notification',
        metadata:     { action: 'mark_all_read', count: result.count },
      },
    }).catch(() => {});

    res.status(200).json({ success: true, data: { updated: result.count } });
  } catch (err) {
    next(err);
  }
});
