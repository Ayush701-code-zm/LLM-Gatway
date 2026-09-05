import { prisma } from '@smartroute/database';
import { providerRegistry } from '../providers/registry';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { cacheHitsTotal, cacheMissesTotal } from '../config/metrics';
import type { CacheCheckResult } from '../types';
import { createHash } from 'crypto';

/**
 * Semantic cache using pgvector cosine similarity.
 *
 * Flow:
 *   1. Generate embedding for incoming prompt
 *   2. Find nearest neighbors in cache_entries (cosine similarity)
 *   3. If similarity ≥ threshold → return cached response
 *   4. Else → proceed to provider, store result + embedding
 */
export class SemanticCacheEngine {
  private readonly threshold: number;

  constructor() {
    this.threshold = env.SEMANTIC_CACHE_THRESHOLD;
  }

  async check(
    prompt: string,
    workspaceId: string,
    useCache: boolean,
    thresholdOverride?: number,
  ): Promise<CacheCheckResult> {
    if (!useCache) return { hit: false, latencyMs: 0 };

    const threshold = thresholdOverride ?? this.threshold;
    const start = Date.now();

    try {
      const embedding = await this.generateEmbedding(prompt);
      const embeddingStr = `[${embedding.join(',')}]`;

      // pgvector cosine similarity search
      const results = await prisma.$queryRaw<
        Array<{ id: string; response: string; cost_usd: number; similarity: number }>
      >`
        SELECT
          id,
          response,
          cost_usd,
          1 - (embedding <=> ${embeddingStr}::vector) AS similarity
        FROM cache_entries
        WHERE
          (workspace_id = ${workspaceId}::uuid OR workspace_id IS NULL)
          AND (expires_at IS NULL OR expires_at > NOW())
          AND 1 - (embedding <=> ${embeddingStr}::vector) >= ${threshold}
        ORDER BY similarity DESC
        LIMIT 1
      `;

      if (results.length > 0) {
        const hit = results[0];
        cacheHitsTotal.inc({ workspace_id: workspaceId });

        // Non-blocking update of hit stats
        prisma.cacheEntry
          .update({
            where: { id: hit.id },
            data: {
              hitCount: { increment: 1 },
              totalSavingsUsd: { increment: hit.cost_usd },
              lastHitAt: new Date(),
            },
          })
          .catch(() => {});

        logger.debug(
          { cacheEntryId: hit.id, similarity: hit.similarity, workspaceId },
          'Semantic cache hit',
        );

        return {
          hit: true,
          response: hit.response,
          cacheEntryId: hit.id,
          similarityScore: hit.similarity,
          latencyMs: Date.now() - start,
          savingsUsd: hit.cost_usd,
        };
      }

      cacheMissesTotal.inc({ workspace_id: workspaceId });
      return { hit: false, latencyMs: Date.now() - start };
    } catch (err) {
      logger.error({ err }, 'Semantic cache check failed — degraded to miss');
      return { hit: false, latencyMs: Date.now() - start };
    }
  }

  async store(params: {
    prompt: string;
    response: string;
    modelId: string;
    provider: string;
    workspaceId: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }): Promise<void> {
    try {
      const embedding = await this.generateEmbedding(params.prompt);
      const embeddingStr = `[${embedding.join(',')}]`;
      const promptHash = createHash('sha256').update(params.prompt).digest('hex');
      const expiresAt = new Date(Date.now() + env.CACHE_TTL_SECONDS * 1000);

      await prisma.$executeRaw`
        INSERT INTO cache_entries (
          id, workspace_id, prompt_hash, prompt, response,
          model_id, provider, input_tokens, output_tokens, cost_usd,
          embedding, expires_at, created_at, updated_at
        ) VALUES (
          gen_random_uuid(),
          ${params.workspaceId}::uuid,
          ${promptHash},
          ${params.prompt},
          ${params.response},
          ${params.modelId},
          ${params.provider}::"ProviderName",
          ${params.inputTokens},
          ${params.outputTokens},
          ${params.costUsd},
          ${embeddingStr}::vector,
          ${expiresAt},
          NOW(),
          NOW()
        )
        ON CONFLICT (prompt_hash) DO UPDATE SET
          hit_count = cache_entries.hit_count,
          updated_at = NOW()
      `;

      logger.debug({ promptHash: promptHash.substring(0, 8) }, 'Cache entry stored');
    } catch (err) {
      logger.error({ err }, 'Failed to store cache entry');
    }
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    const openai = providerRegistry.get('OPENAI');
    return openai.generateEmbedding(text, env.EMBEDDING_MODEL);
  }
}

export const semanticCache = new SemanticCacheEngine();
