import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireApiKey } from '../middleware/auth';
import { requireAnyScope } from '../middleware/apiKeyScope';
import { validate } from '../middleware/validate';
import { providerRegistry } from '../providers/registry';
import { rateLimiterEngine } from '../engines/rateLimiter';
import { prisma } from '@smartroute/database';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';
import { gatewayMetrics } from '../lib/gatewayMetrics';

export const embeddingsRouter = Router();

const EmbeddingsSchema = z.object({
  input: z.union([z.string().min(1), z.array(z.string().min(1)).min(1).max(100)]),
  model: z.string().optional(),
});

embeddingsRouter.post(
  '/',
  requireApiKey,
  requireAnyScope('embeddings:write', 'chat:write'),
  validate(EmbeddingsSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.apiKey!.workspaceId;
      const { input, model: requestedModel } = req.body as z.infer<typeof EmbeddingsSchema>;
      const model = requestedModel ?? env.EMBEDDING_MODEL;

      await rateLimiterEngine.check(workspaceId);

      const modelEntry = await prisma.modelRegistry.findFirst({
        where: { modelId: model, supportsEmbeddings: true, isEnabled: true },
      });

      if (!modelEntry) {
        throw AppError.badRequest(`Embedding model "${model}" not found or not enabled`);
      }

      const provider = providerRegistry.get(modelEntry.provider);
      const texts = Array.isArray(input) ? input : [input];
      const start = Date.now();

      const embeddings = await Promise.all(
        texts.map((text) => provider.generateEmbedding(text, model)),
      );

      const latencyMs = Date.now() - start;
      const totalTokens = texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0);

      gatewayMetrics.recordRequest({
        provider: modelEntry.provider,
        model,
        workspaceId,
        status: 'success',
        latencyMs,
        actualCostUsd: (totalTokens / 1_000_000) * modelEntry.inputCostPerMillion,
        baselineCostUsd: 0,
        cacheHit: false,
      });

      res.status(200).json({
        success: true,
        data: {
          model,
          provider: modelEntry.provider,
          embeddings: texts.length === 1 ? embeddings[0] : embeddings,
          dimensions: embeddings[0]?.length ?? 0,
          usage: { totalTokens, latencyMs },
        },
      });
    } catch (err) {
      next(err);
    }
  },
);
