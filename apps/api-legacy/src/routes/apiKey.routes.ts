import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireEmailVerified } from '../middleware/emailVerified';
import { loadWorkspaceRole, canWrite } from '../middleware/workspaceRole';
import { validate } from '../middleware/validate';
import { CreateApiKeySchema } from '@smartroute/shared';
import { apiKeyService } from '../services/apiKey.service';

export const apiKeyRouter = Router();

apiKeyRouter.use(requireAuth, loadWorkspaceRole);

apiKeyRouter.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.user!.workspaceId;
      const keys = await apiKeyService.list(workspaceId);
      res.status(200).json({ success: true, data: keys });
    } catch (err) {
      next(err);
    }
  },
);

apiKeyRouter.post(
  '/',
  canWrite,
  requireEmailVerified,
  validate(CreateApiKeySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = await apiKeyService.create(
        req.user!.workspaceId,
        req.user!.sub,
        req.body,
      );
      res.status(201).json({
        success: true,
        data: key,
        meta: {
          warning: 'Store the rawKey securely. It will not be shown again.',
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

apiKeyRouter.delete(
  '/:keyId',
  canWrite,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await apiKeyService.revoke(req.user!.workspaceId, String(req.params.keyId), req.user!.sub);
      res.status(200).json({ success: true, data: { message: 'API key revoked' } });
    } catch (err) {
      next(err);
    }
  },
);

apiKeyRouter.post(
  '/:keyId/rotate',
  canWrite,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const newKey = await apiKeyService.rotate(
        req.user!.workspaceId,
        String(req.params.keyId),
        req.user!.sub,
      );
      res.status(201).json({
        success: true,
        data: newKey,
        meta: { warning: 'Store the rawKey securely. It will not be shown again.' },
      });
    } catch (err) {
      next(err);
    }
  },
);
