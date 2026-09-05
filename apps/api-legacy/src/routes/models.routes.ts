/**
 * Model Registry admin routes.
 *
 * GET  /api/v1/models          — list all models (public, no auth required)
 * GET  /api/v1/models/:id      — single model details
 * POST /api/v1/models          — register a new model (admin only)
 * PATCH /api/v1/models/:id     — update model config / pricing (admin only)
 * DELETE /api/v1/models/:id    — soft-delete / disable a model (admin only)
 * POST /api/v1/models/:id/enable   — re-enable a disabled model (admin only)
 * POST /api/v1/models/:id/disable  — disable a model without deleting it (admin only)
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { loadWorkspaceRole, canAdmin } from '../middleware/workspaceRole';
import { getAuthUserId, getAuthWorkspaceId } from '../lib/workspaceContext';
import { validate } from '../middleware/validate';
import { prisma } from '@smartroute/database';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../config/logger';

export const modelsRouter = Router();

// ── Validation schemas ────────────────────────────────────────

const ProviderEnum = z.enum(['OPENAI', 'ANTHROPIC', 'GOOGLE', 'OLLAMA', 'COHERE', 'MISTRAL']);
const QualityTierEnum = z.enum(['ECONOMY', 'STANDARD', 'PREMIUM']);
const ComplexityLevelEnum = z.enum(['SIMPLE', 'MEDIUM', 'COMPLEX']);
const AvailabilityEnum = z.enum(['AVAILABLE', 'DEGRADED', 'UNAVAILABLE', 'UNKNOWN']);

const CreateModelSchema = z.object({
  provider:             ProviderEnum,
  modelId:              z.string().min(1).max(120),
  displayName:          z.string().min(1).max(120),
  description:          z.string().max(500).optional(),
  inputCostPerMillion:  z.number().nonnegative(),
  outputCostPerMillion: z.number().nonnegative(),
  contextWindow:        z.number().int().positive(),
  maxOutputTokens:      z.number().int().positive(),
  supportsStreaming:     z.boolean().default(true),
  supportsVision:        z.boolean().default(false),
  supportsFunctions:     z.boolean().default(false),
  supportsEmbeddings:    z.boolean().default(false),
  qualityTier:          QualityTierEnum,
  complexityMinLevel:   ComplexityLevelEnum,
  isEnabled:            z.boolean().default(true),
});

const PatchModelSchema = CreateModelSchema
  .omit({ provider: true, modelId: true })
  .partial()
  .extend({
    availabilityStatus: AvailabilityEnum.optional(),
  });

// ── Middleware: require admin/owner role ──────────────────────

async function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(AppError.unauthorized());

  const membership = await prisma.workspaceMember.findFirst({
    where:  { userId: req.user.sub, workspaceId: req.user.workspaceId },
    select: { role: true },
  });

  if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
    return next(AppError.forbidden('Admin or Owner role required'));
  }

  next();
}

// ── Routes ────────────────────────────────────────────────────

// GET /api/v1/models — public listing with optional filters
modelsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { provider, enabled, qualityTier } = req.query;

    const models = await prisma.modelRegistry.findMany({
      where: {
        ...(provider    ? { provider: provider as never }         : {}),
        ...(enabled     ? { isEnabled: enabled === 'true' }       : {}),
        ...(qualityTier ? { qualityTier: qualityTier as never }   : {}),
      },
      orderBy: [{ provider: 'asc' }, { qualityTier: 'asc' }, { inputCostPerMillion: 'asc' }],
      select: {
        id:                   true,
        provider:             true,
        modelId:              true,
        displayName:          true,
        description:          true,
        inputCostPerMillion:  true,
        outputCostPerMillion: true,
        contextWindow:        true,
        maxOutputTokens:      true,
        supportsStreaming:     true,
        supportsVision:       true,
        supportsFunctions:    true,
        supportsEmbeddings:   true,
        qualityTier:          true,
        complexityMinLevel:   true,
        availabilityStatus:   true,
        avgLatencyMs:         true,
        p95LatencyMs:         true,
        successRate:          true,
        isEnabled:            true,
        updatedAt:            true,
      },
    });

    res.status(200).json({ success: true, data: models });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/models/:id
modelsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const model = await prisma.modelRegistry.findUnique({
      where: { id: String(req.params.id) },
    });

    if (!model) throw AppError.notFound(`Model ${String(req.params.id)} not found`);
    res.status(200).json({ success: true, data: model });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/models — register a new model (admin)
modelsRouter.post(
  '/',
  requireAuth,
  requireAdmin,
  validate(CreateModelSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = req.body as z.infer<typeof CreateModelSchema>;

      // Check for duplicate provider+modelId
      const existing = await prisma.modelRegistry.findUnique({
        where: { provider_modelId: { provider: data.provider as never, modelId: data.modelId } },
      });
      if (existing) throw AppError.conflict(`Model ${data.provider}/${data.modelId} already exists`);

      const model = await prisma.modelRegistry.create({ data: data as never });

      logger.info({ modelId: model.id, provider: model.provider, modelName: model.modelId }, 'Model registered');
      res.status(201).json({ success: true, data: model });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/models/:id — update pricing, capabilities, status
modelsRouter.patch(
  '/:id',
  requireAuth,
  requireAdmin,
  validate(PatchModelSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.modelRegistry.findUnique({ where: { id: String(req.params.id) } });
      if (!existing) throw AppError.notFound(`Model ${String(req.params.id)} not found`);

      const model = await prisma.modelRegistry.update({
        where: { id: String(req.params.id) },
        data:  req.body as never,
      });

      logger.info({ modelId: model.id, changes: req.body }, 'Model updated');
      res.status(200).json({ success: true, data: model });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/models/:id/enable
modelsRouter.post(
  '/:id/enable',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const model = await prisma.modelRegistry.update({
        where: { id: String(req.params.id) },
        data:  { isEnabled: true, availabilityStatus: 'AVAILABLE' },
      });
      logger.info({ modelId: model.id }, 'Model enabled');
      res.status(200).json({ success: true, data: model });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/models/:id/disable
modelsRouter.post(
  '/:id/disable',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const model = await prisma.modelRegistry.update({
        where: { id: String(req.params.id) },
        data:  { isEnabled: false, availabilityStatus: 'UNAVAILABLE' },
      });
      logger.info({ modelId: model.id }, 'Model disabled');
      res.status(200).json({ success: true, data: model });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/v1/models/:id — hard delete (use /disable for soft-disable)
modelsRouter.delete(
  '/:id',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.modelRegistry.findUnique({ where: { id: String(req.params.id) } });
      if (!existing) throw AppError.notFound(`Model ${String(req.params.id)} not found`);

      await prisma.modelRegistry.delete({ where: { id: String(req.params.id) } });
      logger.warn({ modelId: req.params.id }, 'Model deleted');
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);
