import { prisma } from '@smartroute/database';
import { getRedis } from '../config/redis';
import { classifyComplexity, type ComplexityLevel } from './complexityClassifier';
import { circuitBreaker } from './circuitBreaker';
import type { RoutingContext, RoutingResult, CandidateModel } from '../types';
import { logger } from '../config/logger';

/**
 * Routing Engine — selects the optimal model/provider for a request.
 *
 * Strategy priority (per workspace config):
 *   COST_OPTIMIZED   — cheapest model that meets the complexity threshold
 *   LATENCY_OPTIMIZED — lowest avg latency
 *   PRIORITY_BASED   — explicit provider priority list
 *   ROUND_ROBIN      — distribute load evenly
 */
export class RoutingEngine {
  async route(ctx: RoutingContext): Promise<RoutingResult> {
    const start = Date.now();

    // 1. Get workspace routing config
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: ctx.workspaceId },
      select: {
        defaultRoutingStrategy: true,
        allowedProviders: true,
      },
    });

    const strategy = workspace.defaultRoutingStrategy;
    const allowedProviders = workspace.allowedProviders;

    // 2. Classify complexity
    const { level: complexityLevel, score: complexityScore } = classifyComplexity(ctx.prompt);

    // 3. Load candidate models from registry
    const candidates = await prisma.modelRegistry.findMany({
      where: {
        isEnabled: true,
        availabilityStatus: { in: ['AVAILABLE', 'DEGRADED'] },
        supportsEmbeddings: false,
        ...(allowedProviders.length > 0 && { provider: { in: allowedProviders as never[] } }),
        // Only consider models that can handle the classified complexity
        complexityMinLevel: {
          in: this.getEligibleComplexityLevels(complexityLevel),
        },
      },
      orderBy: [{ qualityTier: 'asc' }, { inputCostPerMillion: 'asc' }],
    });

    if (candidates.length === 0) {
      throw new Error('No eligible models found for routing');
    }

    // 4. Filter out open circuit breakers
    const available: typeof candidates = [];
    for (const model of candidates) {
      const isOpen = await circuitBreaker.isOpen(model.provider, model.modelId);
      if (!isOpen) {
        available.push(model);
      }
    }

    if (available.length === 0) {
      logger.warn({ workspaceId: ctx.workspaceId }, 'All candidate circuit breakers are open, using all candidates');
      available.push(...candidates);
    }

    // 5. Select based on strategy
    const selected = await this.selectByStrategy(available, strategy, ctx.workspaceId);

    const candidateModels: CandidateModel[] = available.map((m: typeof available[number]) => ({
      provider: m.provider,
      modelId: m.modelId,
      estimatedCostUsd: 0, // Will be calculated post-response
      reason: m.qualityTier,
      selected: m.id === selected.id,
    }));

    const decisionLatencyMs = Date.now() - start;

    logger.debug(
      {
        workspaceId: ctx.workspaceId,
        strategy,
        complexityLevel,
        complexityScore,
        selected: `${selected.provider}/${selected.modelId}`,
        decisionLatencyMs,
      },
      'Routing decision made',
    );

    return {
      provider: selected.provider,
      modelId: selected.modelId,
      modelRegistryId: selected.id,
      complexityLevel,
      complexityScore,
      strategy,
      selectionReason: this.buildSelectionReason(strategy, complexityLevel, selected.qualityTier),
      estimatedCostUsd: 0,
      decisionLatencyMs,
      candidateModels,
    };
  }

  private getEligibleComplexityLevels(
    level: ComplexityLevel,
  ): ComplexityLevel[] {
    // A model that handles SIMPLE can also handle MEDIUM and COMPLEX
    // We want models whose MIN level is <= the request level
    switch (level) {
      case 'SIMPLE':
        return ['SIMPLE'];
      case 'MEDIUM':
        return ['SIMPLE', 'MEDIUM'];
      case 'COMPLEX':
        return ['SIMPLE', 'MEDIUM', 'COMPLEX'];
      default:
        return ['SIMPLE', 'MEDIUM', 'COMPLEX'];
    }
  }

  private async selectByStrategy(
    candidates: Array<{
      id: string;
      provider: string;
      modelId: string;
      inputCostPerMillion: number;
      outputCostPerMillion: number;
      avgLatencyMs: number | null;
      qualityTier: string;
    }>,
    strategy: string,
    workspaceId: string,
  ) {
    switch (strategy) {
      case 'COST_OPTIMIZED':
        return [...candidates].sort(
          (a, b) =>
            a.inputCostPerMillion + a.outputCostPerMillion -
            (b.inputCostPerMillion + b.outputCostPerMillion),
        )[0];

      case 'LATENCY_OPTIMIZED':
        return [...candidates].sort(
          (a, b) => (a.avgLatencyMs ?? 9999) - (b.avgLatencyMs ?? 9999),
        )[0];

      case 'PRIORITY_BASED': {
        const priorityMap: Record<string, number> = { ECONOMY: 0, STANDARD: 1, PREMIUM: 2 };
        return [...candidates].sort(
          (a, b) => (priorityMap[b.qualityTier] ?? 0) - (priorityMap[a.qualityTier] ?? 0),
        )[0];
      }

      case 'ROUND_ROBIN': {
        const redis = getRedis();
        const key = `routing:rr:${workspaceId}`;
        const idx = await redis.incr(key);
        if (idx === 1) await redis.expire(key, 3600);
        return candidates[(idx - 1) % candidates.length];
      }

      case 'WEIGHTED_RANDOM': {
        const weights = candidates.map((c) => {
          const cost = c.inputCostPerMillion + c.outputCostPerMillion + 0.01;
          return 1 / cost;
        });
        const total = weights.reduce((a, b) => a + b, 0);
        let roll = Math.random() * total;
        for (let i = 0; i < candidates.length; i++) {
          roll -= weights[i];
          if (roll <= 0) return candidates[i];
        }
        return candidates[candidates.length - 1];
      }

      default:
        return candidates[0];
    }
  }

  private buildSelectionReason(strategy: string, complexity: string, qualityTier: string): string {
    return `Strategy=${strategy}, Complexity=${complexity}, QualityTier=${qualityTier}`;
  }
}

export const routingEngine = new RoutingEngine();
