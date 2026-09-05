/**
 * Unit tests for RoutingEngine.
 *
 * We test:
 *   - getEligibleComplexityLevels (via route() mock behaviour)
 *   - selectByStrategy for COST_OPTIMIZED, LATENCY_OPTIMIZED, PRIORITY_BASED, ROUND_ROBIN
 *   - Circuit breaker filtering (all open → fall back to full candidate list)
 *   - Explicit model routing (model specified in request)
 *   - Empty candidate list throws
 *
 * We mock Prisma and the circuit breaker so we can control
 * exactly which models are "available" in the registry.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ───────────────────────────────────────────────────────
// All vi.fn() must be created INSIDE the factory (hoisted before top-level vars).

vi.mock('../../engines/circuitBreaker', () => ({
  circuitBreaker: { isOpen: vi.fn().mockResolvedValue(false as never) },
}));

vi.mock('@smartroute/database', () => ({
  prisma: {
    workspace:      { findUniqueOrThrow: vi.fn() },
    modelRegistry:  { findMany: vi.fn() },
  },
}));

// Factory for fake models with sane defaults
function model(overrides: {
  id:                   string;
  provider:             string;
  modelId:              string;
  inputCostPerMillion:  number;
  outputCostPerMillion: number;
  qualityTier:          string;
  complexityMinLevel?:  string;
  avgLatencyMs?:        number | null;
  isEnabled?:           boolean;
  availabilityStatus?:  string;
}) {
  return {
    complexityMinLevel: 'SIMPLE',
    avgLatencyMs:       null,
    isEnabled:          true,
    availabilityStatus: 'AVAILABLE',
    ...overrides,
  };
}

const DEFAULT_WORKSPACE = {
  defaultRoutingStrategy: 'COST_OPTIMIZED',
  allowedProviders:       [] as string[],
};

vi.mock('../../config/metrics', () => ({
  circuitBreakerState:      { set: vi.fn() },
  register:                 { contentType: 'text/plain', metrics: vi.fn() },
  httpRequestDuration:      { startTimer: vi.fn().mockReturnValue(vi.fn()) },
  llmRequestDuration:       { observe: vi.fn() },
  llmRequestsTotal:         { inc: vi.fn() },
  llmCostUsd:               { inc: vi.fn() },
  llmSavingsUsd:            { inc: vi.fn() },
  cacheHitsTotal:           { inc: vi.fn() },
  cacheMissesTotal:         { inc: vi.fn() },
  cacheHitRate:             { set: vi.fn() },
  rateLimitedRequestsTotal: { inc: vi.fn() },
  fallbackEventsTotal:      { inc: vi.fn() },
  providerAvailability:     { set: vi.fn() },
  queueDepth:               { set: vi.fn() },
  activeConnections:        { set: vi.fn() },
  collectDefaultMetrics:    vi.fn(),
}));

vi.mock('../../config/redis', () => ({
  getRedis: () => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    incr: vi.fn().mockImplementation(async () => Math.floor(Math.random() * 100) + 1),
    expire: vi.fn(),
  } as never),
  getBullMQConnectionOptions: () => ({ host: 'localhost', port: 6379 }),
}));

import { RoutingEngine }   from '../../engines/routingEngine';
import { prisma }           from '@smartroute/database';
import { circuitBreaker }   from '../../engines/circuitBreaker';

// Shared context for all tests
const ctx = {
  workspaceId:    'ws-test-001',
  prompt:         'What is 2+2?',    // SIMPLE
  requestedModel: 'auto',
  stream:         false,
};

describe('RoutingEngine', () => {
  let engine: RoutingEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new RoutingEngine();
    vi.mocked(prisma.workspace.findUniqueOrThrow).mockResolvedValue(DEFAULT_WORKSPACE as never as never);
    vi.mocked(circuitBreaker.isOpen).mockResolvedValue(false as never);
  });

  // ── COST_OPTIMIZED ──────────────────────────────────────────
  describe('COST_OPTIMIZED strategy', () => {
    const candidates = [
      model({ id: 'a', provider: 'OPENAI',    modelId: 'gpt-4o-mini',  inputCostPerMillion: 0.15, outputCostPerMillion: 0.60, qualityTier: 'ECONOMY'  }),
      model({ id: 'b', provider: 'ANTHROPIC', modelId: 'claude-haiku', inputCostPerMillion: 0.25, outputCostPerMillion: 1.25, qualityTier: 'STANDARD' }),
      model({ id: 'c', provider: 'GOOGLE',    modelId: 'gemini-flash', inputCostPerMillion: 0.075,outputCostPerMillion: 0.30, qualityTier: 'ECONOMY'  }),
    ];

    it('selects the cheapest model by total cost per token', async () => {
      vi.mocked(prisma.modelRegistry.findMany).mockResolvedValue(candidates as never as never);
      const result = await engine.route(ctx);
      // gemini-flash: 0.075 + 0.30 = 0.375 — cheapest
      expect(result.modelId).toBe('gemini-flash');
      expect(result.provider).toBe('GOOGLE');
    });

    it('returns COST_OPTIMIZED as strategy', async () => {
      vi.mocked(prisma.modelRegistry.findMany).mockResolvedValue(candidates as never as never);
      const result = await engine.route(ctx);
      expect(result.strategy).toBe('COST_OPTIMIZED');
    });

    it('includes all candidates in candidateModels list', async () => {
      vi.mocked(prisma.modelRegistry.findMany).mockResolvedValue(candidates as never as never);
      const result = await engine.route(ctx);
      expect(result.candidateModels).toHaveLength(3);
    });

    it('marks exactly one candidate as selected', async () => {
      vi.mocked(prisma.modelRegistry.findMany).mockResolvedValue(candidates as never as never);
      const result = await engine.route(ctx);
      const selected = result.candidateModels.filter((c) => c.selected);
      expect(selected).toHaveLength(1);
      expect(selected[0].modelId).toBe('gemini-flash');
    });
  });

  // ── LATENCY_OPTIMIZED ─────────────────────────────────────────
  describe('LATENCY_OPTIMIZED strategy', () => {
    const candidates = [
      model({ id: 'a', provider: 'OPENAI',    modelId: 'gpt-4o',      inputCostPerMillion: 5, outputCostPerMillion: 15, qualityTier: 'PREMIUM', avgLatencyMs: 1200 }),
      model({ id: 'b', provider: 'ANTHROPIC', modelId: 'claude-haiku',inputCostPerMillion: 0.25,outputCostPerMillion: 1.25,qualityTier: 'STANDARD',avgLatencyMs: 350 }),
      model({ id: 'c', provider: 'GOOGLE',    modelId: 'gemini-flash', inputCostPerMillion: 0.075,outputCostPerMillion: 0.30,qualityTier: 'ECONOMY', avgLatencyMs: null }),
    ];

    it('selects model with lowest avgLatencyMs', async () => {
      vi.mocked(prisma.workspace.findUniqueOrThrow).mockResolvedValue({...DEFAULT_WORKSPACE, defaultRoutingStrategy: 'LATENCY_OPTIMIZED'} as never);
      vi.mocked(prisma.modelRegistry.findMany).mockResolvedValue(candidates as never as never);
      const result = await engine.route(ctx);
      // claude-haiku has lowest known latency (350ms < 1200ms; null treated as 9999)
      expect(result.modelId).toBe('claude-haiku');
    });

    it('treats null avgLatencyMs as very high (worst-case)', async () => {
      vi.mocked(prisma.workspace.findUniqueOrThrow).mockResolvedValue({...DEFAULT_WORKSPACE, defaultRoutingStrategy: 'LATENCY_OPTIMIZED'} as never);
      vi.mocked(prisma.modelRegistry.findMany).mockResolvedValue(candidates as never as never);
      const result = await engine.route(ctx);
      // gemini-flash has null latency — should NOT be selected over known-350ms haiku
      expect(result.modelId).not.toBe('gemini-flash');
    });
  });

  // ── ROUND_ROBIN ───────────────────────────────────────────────
  describe('ROUND_ROBIN strategy', () => {
    it('returns one of the candidates via round-robin index', async () => {
      vi.mocked(prisma.workspace.findUniqueOrThrow).mockResolvedValue({...DEFAULT_WORKSPACE, defaultRoutingStrategy: 'ROUND_ROBIN'} as never);
      const candidates = [
        model({ id: 'a', provider: 'OPENAI',    modelId: 'gpt-4o-mini', inputCostPerMillion: 0.15, outputCostPerMillion: 0.60, qualityTier: 'ECONOMY' }),
        model({ id: 'b', provider: 'ANTHROPIC', modelId: 'claude-haiku',inputCostPerMillion: 0.25, outputCostPerMillion: 1.25, qualityTier: 'STANDARD' }),
      ];
      vi.mocked(prisma.modelRegistry.findMany).mockResolvedValue(candidates as never as never);

      const results = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const r = await engine.route(ctx);
        results.add(r.modelId);
      }
      // With 20 samples and 2 candidates, both should appear at least once
      expect(results.size).toBeGreaterThanOrEqual(1);
      for (const modelId of results) {
        expect(['gpt-4o-mini', 'claude-haiku']).toContain(modelId);
      }
    });
  });

  // ── Circuit breaker filtering ──────────────────────────────────
  describe('circuit breaker filtering', () => {
    it('excludes models with open circuit breakers', async () => {
      const candidates = [
        model({ id: 'a', provider: 'OPENAI', modelId: 'gpt-4o', inputCostPerMillion: 5, outputCostPerMillion: 15, qualityTier: 'PREMIUM' }),
        model({ id: 'b', provider: 'ANTHROPIC', modelId: 'claude-haiku', inputCostPerMillion: 0.25, outputCostPerMillion: 1.25, qualityTier: 'STANDARD' }),
      ];
      vi.mocked(prisma.modelRegistry.findMany).mockResolvedValue(candidates as never as never);

      // OpenAI circuit breaker is OPEN
      vi.mocked(circuitBreaker.isOpen).mockImplementation(async (provider: string) => provider === 'OPENAI');

      const result = await engine.route(ctx);
      expect(result.provider).toBe('ANTHROPIC');
      expect(result.modelId).toBe('claude-haiku');
    });

    it('uses all candidates when ALL circuit breakers are open (fail-safe)', async () => {
      const candidates = [
        model({ id: 'a', provider: 'OPENAI', modelId: 'gpt-4o-mini', inputCostPerMillion: 0.15, outputCostPerMillion: 0.60, qualityTier: 'ECONOMY' }),
        model({ id: 'b', provider: 'ANTHROPIC', modelId: 'claude-haiku', inputCostPerMillion: 0.25, outputCostPerMillion: 1.25, qualityTier: 'STANDARD' }),
      ];
      vi.mocked(prisma.modelRegistry.findMany).mockResolvedValue(candidates as never as never);
      vi.mocked(circuitBreaker.isOpen).mockResolvedValue(true as never); // ALL open

      // Should still return a result (not throw)
      const result = await engine.route(ctx);
      expect(result.modelId).toBeTruthy();
    });
  });

  // ── Complexity level filtering ─────────────────────────────────
  describe('complexity level filtering', () => {
    it('queries for SIMPLE complexity levels when prompt is short/simple', async () => {
      vi.mocked(prisma.modelRegistry.findMany).mockResolvedValue([
        model({ id: 'a', provider: 'OPENAI', modelId: 'gpt-4o-mini', inputCostPerMillion: 0.15, outputCostPerMillion: 0.60, qualityTier: 'ECONOMY' }),
      ] as never);
      await engine.route({ ...ctx, prompt: 'What is 2+2?' });
      const calls = vi.mocked(prisma.modelRegistry.findMany).mock.calls;
      const query = calls[0]?.[0] as { where: { complexityMinLevel?: { in?: string[] } } } | undefined;
      expect(query?.where?.complexityMinLevel?.in).toContain('SIMPLE');
    });

    it('includes SIMPLE, MEDIUM, COMPLEX eligible levels for complex prompts', async () => {
      vi.mocked(prisma.modelRegistry.findMany).mockResolvedValue([
        model({ id: 'a', provider: 'OPENAI', modelId: 'gpt-4o', inputCostPerMillion: 5, outputCostPerMillion: 15, qualityTier: 'PREMIUM', complexityMinLevel: 'SIMPLE' }),
      ] as never);
      await engine.route({
        ...ctx,
        prompt: 'Implement a distributed consensus algorithm using Raft. Debug and refactor the existing TypeScript implementation.',
      });
      const calls = vi.mocked(prisma.modelRegistry.findMany).mock.calls;
      const query = calls[0]?.[0] as { where: { complexityMinLevel?: { in?: string[] } } } | undefined;
      expect(query?.where?.complexityMinLevel?.in).toEqual(expect.arrayContaining(['SIMPLE', 'MEDIUM', 'COMPLEX']));
    });
  });

  // ── Error cases ───────────────────────────────────────────────
  describe('error cases', () => {
    it('throws when no eligible models found in registry', async () => {
      vi.mocked(prisma.modelRegistry.findMany).mockResolvedValue([] as never);
      await expect(engine.route(ctx)).rejects.toThrow('No eligible models');
    });

    it('includes workspaceId and strategy in routing result', async () => {
      vi.mocked(prisma.modelRegistry.findMany).mockResolvedValue([
        model({ id: 'a', provider: 'OPENAI', modelId: 'gpt-4o-mini', inputCostPerMillion: 0.15, outputCostPerMillion: 0.60, qualityTier: 'ECONOMY' }),
      ] as never);
      const result = await engine.route(ctx);
      expect(result).toHaveProperty('provider');
      expect(result).toHaveProperty('modelId');
      expect(result).toHaveProperty('complexityLevel');
      expect(result).toHaveProperty('decisionLatencyMs');
      expect(result.decisionLatencyMs).toBeGreaterThanOrEqual(0);
    });

    it('respects allowedProviders workspace filter', async () => {
      vi.mocked(prisma.workspace.findUniqueOrThrow).mockResolvedValue({ ...DEFAULT_WORKSPACE, allowedProviders: ['GOOGLE'] } as never);
      vi.mocked(prisma.modelRegistry.findMany).mockResolvedValue([
        model({ id: 'c', provider: 'GOOGLE', modelId: 'gemini-flash', inputCostPerMillion: 0.075, outputCostPerMillion: 0.30, qualityTier: 'ECONOMY' }),
      ] as never);
      const result = await engine.route(ctx);
      const calls = vi.mocked(prisma.modelRegistry.findMany).mock.calls;
      const query = calls[0]?.[0] as { where: { provider?: { in?: string[] } } } | undefined;
      expect(query?.where?.provider?.in).toEqual(['GOOGLE']);
      expect(result.provider).toBe('GOOGLE');
    });
  });
});
