import { prisma } from '@smartroute/database';
import { routingEngine } from '../engines/routingEngine';
import { circuitBreaker } from '../engines/circuitBreaker';
import { rateLimiterEngine } from '../engines/rateLimiter';
import { budgetGuard } from '../engines/budgetGuard';
import { semanticCache } from '../engines/semanticCache';
import { providerRegistry } from '../providers/registry';
import { logger } from '../config/logger';
import { llmRequestDuration, fallbackEventsTotal } from '../config/metrics';
import { gatewayMetrics } from '../lib/gatewayMetrics';
import { requestCoalescer } from '../lib/requestCoalescer';
import { estimateTokens } from '../lib/tokenEstimator';
import { enqueueAnalyticsEvent } from '../queues/index';
import { calculateCostUsd, calculateSavingsPercent, calculateExponentialBackoff, sleep } from '@smartroute/shared';
import { RETRY_CONFIG } from '@smartroute/shared';
import { AppError } from '../middleware/errorHandler';
import type { ChatRequest, ChatResponse } from '@smartroute/shared';
import type { ApiKeyContext } from '../types';
import type { LLMStreamChunk } from '../types';

import type { RateLimitInfo } from '../engines/rateLimiter';

export interface StreamHandlers {
  onRouting: (data: {
    provider: string;
    model: string;
    complexityLevel: string;
    strategy: string;
    cacheHit?: boolean;
  }) => void;
  onDelta: (content: string) => void;
}

export interface StreamDonePayload {
  requestId: string;
  traceId: string;
  finishReason: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  cost: { actualUsd: number; baselineUsd: number; savingsUsd: number };
  routing: {
    provider: string;
    model: string;
    strategy: string;
    complexityLevel: string;
    fallbackUsed: boolean;
    retryCount: number;
  };
}

interface GatewayOptions {
  requestId:    string;
  traceId:      string;
  apiKey:       ApiKeyContext;
  /** Callback to propagate rate limit info back to the HTTP layer for response headers */
  onRateLimit?: (info: RateLimitInfo) => void;
}

export class GatewayService {
  async processChat(
    request: ChatRequest,
    options: GatewayOptions,
  ): Promise<ChatResponse> {
    const { requestId, traceId, apiKey } = options;
    const workspaceId = apiKey.workspaceId;
    const overallStart = Date.now();

    logger.info({ requestId, traceId, workspaceId, model: request.model }, 'Processing chat request');

    // 1. Rate limiting
    const rateLimitInfo = await rateLimiterEngine.check(workspaceId);
    options.onRateLimit?.(rateLimitInfo);

    // 2. Pre-estimate token count for smarter budget pre-flight
    const tokenEstimate = estimateTokens(
      [{ role: 'user', content: request.message }],
      request.model === 'auto' ? 'gpt-4o' : request.model,
      request.maxTokens,
    );
    // Pre-flight budget check using estimated cost (avoids firing LLM call only to block it)
    await rateLimiterEngine.checkTokens(workspaceId, tokenEstimate.totalTokens);
    await budgetGuard.check(workspaceId, 0); // 0 = pre-flight; actual cost enforced after response

    // 3. Semantic cache check
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { semanticCacheEnabled: true, cacheThreshold: true },
    });

    const cacheResult = await semanticCache.check(
      request.message,
      workspaceId,
      workspace.semanticCacheEnabled,
      workspace.cacheThreshold,
    );

    if (cacheResult.hit && cacheResult.response) {
      const latencyMs = Date.now() - overallStart;
      // Record cached request
      const req = await prisma.request.create({
        data: {
          id: requestId,
          traceId,
          workspaceId,
          apiKeyId: apiKey.id,
          status: 'CACHED',
          prompt: request.message,
          systemPrompt: request.systemPrompt,
          requestedModel: request.model,
          response: cacheResult.response,
          cacheHit: true,
          cacheEntryId: cacheResult.cacheEntryId,
          cacheSimilarityScore: cacheResult.similarityScore,
          totalLatencyMs: latencyMs,
          actualCostUsd: 0,
          baselineCostUsd: cacheResult.savingsUsd ?? 0,
          savingsUsd: cacheResult.savingsUsd ?? 0,
          finishReason: 'cache',
        },
      });

      gatewayMetrics.recordRequest({
        provider:        'cache',
        model:           'semantic-cache',
        workspaceId,
        status:          'cached',
        latencyMs,
        actualCostUsd:   0,
        baselineCostUsd: cacheResult.savingsUsd ?? 0,
        cacheHit:        true,
      });
      enqueueAnalyticsEvent({
        provider:        'cache',
        model:           'semantic-cache',
        workspaceId,
        status:          'cached',
        latencyMs,
        actualCostUsd:   0,
        baselineCostUsd: cacheResult.savingsUsd ?? 0,
        cacheHit:        true,
      });

      return this.buildResponse({
        requestId: req.id,
        traceId,
        message: cacheResult.response,
        model: 'cached',
        provider: 'cache',
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        actualCostUsd: 0,
        baselineCostUsd: cacheResult.savingsUsd ?? 0,
        savingsUsd: cacheResult.savingsUsd ?? 0,
        totalLatencyMs: Date.now() - overallStart,
        providerLatencyMs: 0,
        cacheHit: true,
        complexityLevel: 'SIMPLE',
        complexityScore: 0,
        strategy: 'CACHE',
        fallbackUsed: false,
        retryCount: 0,
        finishReason: 'cache',
      });
    }

    // 4. Route to model
    const routingResult = await routingEngine.route({
      workspaceId,
      prompt: request.message,
      requestedModel: request.model,
      stream: request.stream,
    });

    // 5. Execute with retry + fallback, coalescing identical concurrent requests
    const { response, fallbackUsed, retryCount, providerUsed, modelUsed } =
      await requestCoalescer.coalesce(
        {
          workspaceId,
          model:       routingResult.modelId,
          messages:    [{ role: 'user', content: request.message }],
          temperature: request.temperature,
          maxTokens:   request.maxTokens,
        },
        () => this.executeWithRetryAndFallback(request, routingResult, workspaceId, requestId, traceId),
      );

    // 6. Calculate costs
    const modelEntry = await prisma.modelRegistry.findFirst({
      where: { provider: providerUsed as never, modelId: modelUsed },
    });

    const actualCostUsd = calculateCostUsd(
      response.inputTokens,
      response.outputTokens,
      modelEntry?.inputCostPerMillion ?? 0,
      modelEntry?.outputCostPerMillion ?? 0,
    );

    // Baseline = most expensive eligible premium model
    const premiumModel = await prisma.modelRegistry.findFirst({
      where: { qualityTier: 'PREMIUM', isEnabled: true, supportsEmbeddings: false },
      orderBy: { inputCostPerMillion: 'desc' },
    });

    const baselineCostUsd = calculateCostUsd(
      response.inputTokens,
      response.outputTokens,
      premiumModel?.inputCostPerMillion ?? 10,
      premiumModel?.outputCostPerMillion ?? 30,
    );

    const savingsUsd = Math.max(0, baselineCostUsd - actualCostUsd);

    // 7. Post-flight budget check & spend recording
    await budgetGuard.check(workspaceId, actualCostUsd);
    budgetGuard.recordSpend(workspaceId, actualCostUsd).catch(() => {});

    // 8. Store cache entry (non-blocking)
    if (!cacheResult.hit && workspace.semanticCacheEnabled) {
      semanticCache
        .store({
          prompt: request.message,
          response: response.content,
          modelId: modelUsed,
          provider: providerUsed,
          workspaceId,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          costUsd: actualCostUsd,
        })
        .catch(() => {});
    }

    // 9. Persist request record
    const totalLatencyMs = Date.now() - overallStart;

    const requestRecord = await prisma.request.create({
      data: {
        id: requestId,
        traceId,
        workspaceId,
        apiKeyId: apiKey.id,
        modelRegistryId: modelEntry?.id,
        status: 'COMPLETED',
        prompt: request.message,
        systemPrompt: request.systemPrompt,
        requestedModel: request.model,
        response: response.content,
        finishReason: response.finishReason,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        totalTokens: response.inputTokens + response.outputTokens,
        actualCostUsd,
        baselineCostUsd,
        savingsUsd,
        totalLatencyMs,
        providerLatencyMs: response.latencyMs,
        cacheHit: false,
        complexityLevel: routingResult.complexityLevel as never,
        fallbackUsed,
        retryCount,
        streamingEnabled: request.stream,
      },
    });

    // 10. Persist routing decision
    prisma.routingDecision
      .create({
        data: {
          requestId: requestRecord.id,
          modelRegistryId: modelEntry?.id ?? routingResult.modelRegistryId,
          strategy: routingResult.strategy as never,
          complexityLevel: routingResult.complexityLevel as never,
          complexityScore: routingResult.complexityScore,
          candidateModels: routingResult.candidateModels as never,
          selectionReason: routingResult.selectionReason,
          estimatedCostUsd: actualCostUsd,
          decisionLatencyMs: routingResult.decisionLatencyMs,
        },
      })
      .catch(() => {});

    // 11. Metrics
    gatewayMetrics.recordRequest({
      provider:        providerUsed,
      model:           modelUsed,
      workspaceId,
      status:          fallbackUsed ? 'fallback' : 'success',
      latencyMs:       totalLatencyMs,
      actualCostUsd,
      baselineCostUsd,
      cacheHit:        false,
    });
    enqueueAnalyticsEvent({
      provider:        providerUsed,
      model:           modelUsed,
      workspaceId,
      status:          fallbackUsed ? 'fallback' : 'success',
      latencyMs:       totalLatencyMs,
      actualCostUsd,
      baselineCostUsd,
      cacheHit:        false,
    });

    logger.info(
      {
        requestId,
        provider: providerUsed,
        model: modelUsed,
        totalLatencyMs,
        actualCostUsd: actualCostUsd.toFixed(6),
        savingsUsd: savingsUsd.toFixed(6),
        fallbackUsed,
        retryCount,
      },
      'Chat request completed',
    );

    return this.buildResponse({
      requestId: requestRecord.id,
      traceId,
      message: response.content,
      model: modelUsed,
      provider: providerUsed,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      totalTokens: response.inputTokens + response.outputTokens,
      actualCostUsd,
      baselineCostUsd,
      savingsUsd,
      totalLatencyMs,
      providerLatencyMs: response.latencyMs,
      cacheHit: false,
      complexityLevel: routingResult.complexityLevel,
      complexityScore: routingResult.complexityScore,
      strategy: routingResult.strategy,
      fallbackUsed,
      retryCount,
      finishReason: response.finishReason,
    });
  }

  /** Full gateway pipeline for SSE streaming (cache, routing, fallback, metrics). */
  async processChatStream(
    request: ChatRequest,
    options: GatewayOptions,
    handlers: StreamHandlers,
  ): Promise<StreamDonePayload> {
    const { requestId, traceId, apiKey } = options;
    const workspaceId = apiKey.workspaceId;
    const overallStart = Date.now();

    const rateLimitInfo = await rateLimiterEngine.check(workspaceId);
    options.onRateLimit?.(rateLimitInfo);

    const tokenEstimate = estimateTokens(
      [{ role: 'user', content: request.message }],
      request.model === 'auto' ? 'gpt-4o' : request.model,
      request.maxTokens,
    );
    await rateLimiterEngine.checkTokens(workspaceId, tokenEstimate.totalTokens);
    await budgetGuard.check(workspaceId, 0);

    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { semanticCacheEnabled: true, cacheThreshold: true },
    });

    const cacheResult = await semanticCache.check(
      request.message,
      workspaceId,
      workspace.semanticCacheEnabled,
      workspace.cacheThreshold,
    );

    if (cacheResult.hit && cacheResult.response) {
      const latencyMs = Date.now() - overallStart;
      handlers.onRouting({
        provider: 'cache',
        model: 'semantic-cache',
        complexityLevel: 'SIMPLE',
        strategy: 'CACHE',
        cacheHit: true,
      });
      handlers.onDelta(cacheResult.response);

      await prisma.request.create({
        data: {
          id: requestId,
          traceId,
          workspaceId,
          apiKeyId: apiKey.id,
          status: 'CACHED',
          prompt: request.message,
          systemPrompt: request.systemPrompt,
          requestedModel: request.model,
          response: cacheResult.response,
          cacheHit: true,
          cacheEntryId: cacheResult.cacheEntryId,
          cacheSimilarityScore: cacheResult.similarityScore,
          totalLatencyMs: latencyMs,
          actualCostUsd: 0,
          baselineCostUsd: cacheResult.savingsUsd ?? 0,
          savingsUsd: cacheResult.savingsUsd ?? 0,
          finishReason: 'cache',
          streamingEnabled: true,
        },
      });

      gatewayMetrics.recordRequest({
        provider: 'cache',
        model: 'semantic-cache',
        workspaceId,
        status: 'cached',
        latencyMs,
        actualCostUsd: 0,
        baselineCostUsd: cacheResult.savingsUsd ?? 0,
        cacheHit: true,
      });
      enqueueAnalyticsEvent({
        provider: 'cache',
        model: 'semantic-cache',
        workspaceId,
        status: 'cached',
        latencyMs,
        actualCostUsd: 0,
        baselineCostUsd: cacheResult.savingsUsd ?? 0,
        cacheHit: true,
      });

      return {
        requestId,
        traceId,
        finishReason: 'cache',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        cost: {
          actualUsd: 0,
          baselineUsd: cacheResult.savingsUsd ?? 0,
          savingsUsd: cacheResult.savingsUsd ?? 0,
        },
        routing: {
          provider: 'cache',
          model: 'semantic-cache',
          strategy: 'CACHE',
          complexityLevel: 'SIMPLE',
          fallbackUsed: false,
          retryCount: 0,
        },
      };
    }

    const routingResult = await routingEngine.route({
      workspaceId,
      prompt: request.message,
      requestedModel: request.model,
      stream: true,
    });

    handlers.onRouting({
      provider: routingResult.provider,
      model: routingResult.modelId,
      complexityLevel: routingResult.complexityLevel,
      strategy: routingResult.strategy,
    });

    const { response, fallbackUsed, retryCount, providerUsed, modelUsed } =
      await this.executeStreamWithRetryAndFallback(request, routingResult, requestId, traceId, handlers.onDelta);

    const modelEntry = await prisma.modelRegistry.findFirst({
      where: { provider: providerUsed as never, modelId: modelUsed },
    });

    const actualCostUsd = calculateCostUsd(
      response.inputTokens,
      response.outputTokens,
      modelEntry?.inputCostPerMillion ?? 0,
      modelEntry?.outputCostPerMillion ?? 0,
    );

    const premiumModel = await prisma.modelRegistry.findFirst({
      where: { qualityTier: 'PREMIUM', isEnabled: true, supportsEmbeddings: false },
      orderBy: { inputCostPerMillion: 'desc' },
    });

    const baselineCostUsd = calculateCostUsd(
      response.inputTokens,
      response.outputTokens,
      premiumModel?.inputCostPerMillion ?? 10,
      premiumModel?.outputCostPerMillion ?? 30,
    );

    const savingsUsd = Math.max(0, baselineCostUsd - actualCostUsd);

    await budgetGuard.check(workspaceId, actualCostUsd);
    budgetGuard.recordSpend(workspaceId, actualCostUsd).catch(() => {});

    if (workspace.semanticCacheEnabled) {
      semanticCache
        .store({
          prompt: request.message,
          response: response.content,
          modelId: modelUsed,
          provider: providerUsed,
          workspaceId,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          costUsd: actualCostUsd,
        })
        .catch(() => {});
    }

    const totalLatencyMs = Date.now() - overallStart;

    await prisma.request.create({
      data: {
        id: requestId,
        traceId,
        workspaceId,
        apiKeyId: apiKey.id,
        modelRegistryId: modelEntry?.id,
        status: 'COMPLETED',
        prompt: request.message,
        systemPrompt: request.systemPrompt,
        requestedModel: request.model,
        response: response.content,
        finishReason: response.finishReason,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        totalTokens: response.inputTokens + response.outputTokens,
        actualCostUsd,
        baselineCostUsd,
        savingsUsd,
        totalLatencyMs,
        providerLatencyMs: response.latencyMs,
        cacheHit: false,
        complexityLevel: routingResult.complexityLevel as never,
        fallbackUsed,
        retryCount,
        streamingEnabled: true,
      },
    });

    prisma.routingDecision
      .create({
        data: {
          requestId,
          modelRegistryId: modelEntry?.id ?? routingResult.modelRegistryId,
          strategy: routingResult.strategy as never,
          complexityLevel: routingResult.complexityLevel as never,
          complexityScore: routingResult.complexityScore,
          candidateModels: routingResult.candidateModels as never,
          selectionReason: routingResult.selectionReason,
          estimatedCostUsd: actualCostUsd,
          decisionLatencyMs: routingResult.decisionLatencyMs,
        },
      })
      .catch(() => {});

    gatewayMetrics.recordRequest({
      provider: providerUsed,
      model: modelUsed,
      workspaceId,
      status: fallbackUsed ? 'fallback' : 'success',
      latencyMs: totalLatencyMs,
      actualCostUsd,
      baselineCostUsd,
      cacheHit: false,
    });
    enqueueAnalyticsEvent({
      provider: providerUsed,
      model: modelUsed,
      workspaceId,
      status: fallbackUsed ? 'fallback' : 'success',
      latencyMs: totalLatencyMs,
      actualCostUsd,
      baselineCostUsd,
      cacheHit: false,
    });

    return {
      requestId,
      traceId,
      finishReason: response.finishReason,
      usage: {
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        totalTokens: response.inputTokens + response.outputTokens,
      },
      cost: { actualUsd: actualCostUsd, baselineUsd: baselineCostUsd, savingsUsd },
      routing: {
        provider: providerUsed,
        model: modelUsed,
        strategy: routingResult.strategy,
        complexityLevel: routingResult.complexityLevel,
        fallbackUsed,
        retryCount,
      },
    };
  }

  private async executeStreamWithRetryAndFallback(
    request: ChatRequest,
    routing: Awaited<ReturnType<typeof routingEngine.route>>,
    requestId: string,
    traceId: string,
    onDelta: (content: string) => void,
  ) {
    const providers = [
      { provider: routing.provider, model: routing.modelId },
      ...(await this.buildFallbackChain(routing.provider, routing.modelId)),
    ];

    let lastError: Error | null = null;
    let retryCount = 0;
    let fallbackUsed = false;

    for (let i = 0; i < providers.length; i++) {
      const { provider: providerName, model } = providers[i];
      const isFirst = i === 0;
      const maxAttempts = isFirst ? RETRY_CONFIG.MAX_ATTEMPTS : 1;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (attempt > 1) {
          const delay = calculateExponentialBackoff(
            attempt - 1,
            RETRY_CONFIG.BASE_DELAY_MS,
            RETRY_CONFIG.MAX_DELAY_MS,
          );
          await sleep(delay);
          retryCount++;
        }

        try {
          const isOpen = await circuitBreaker.isOpen(providerName, model);
          if (isOpen) {
            throw new Error(`Circuit breaker OPEN for ${providerName}/${model}`);
          }

          const providerClient = providerRegistry.get(providerName);
          const llmStart = Date.now();

          const llmResponse = await providerClient.stream(
            {
              model,
              messages: [
                ...(request.systemPrompt
                  ? [{ role: 'system' as const, content: request.systemPrompt }]
                  : []),
                { role: 'user' as const, content: request.message },
              ],
              maxTokens: request.maxTokens,
              temperature: request.temperature,
              stream: true,
            },
            (chunk: LLMStreamChunk) => {
              if (!chunk.done && chunk.content) onDelta(chunk.content);
            },
          );

          llmRequestDuration.observe(
            { provider: providerName, model, status: 'success' },
            (Date.now() - llmStart) / 1000,
          );

          await circuitBreaker.recordSuccess(providerName, model);
          gatewayMetrics.updateCircuitBreaker(providerName, model, 'CLOSED');

          const modelEntry = await prisma.modelRegistry.findFirst({
            where: { provider: providerName as never, modelId: model },
          });

          if (modelEntry) {
            prisma.providerLog.create({
              data: {
                requestId,
                modelRegistryId: modelEntry.id,
                attemptNumber: attempt,
                success: true,
                latencyMs: llmResponse.latencyMs,
                inputTokens: llmResponse.inputTokens,
                outputTokens: llmResponse.outputTokens,
                costUsd: providerClient.calculateCost(
                  llmResponse.inputTokens,
                  llmResponse.outputTokens,
                  model,
                ),
              },
            }).catch(() => {});
          }

          if (!isFirst) {
            fallbackUsed = true;
            const firstProvider = providers[0];
            prisma.fallbackEvent
              .create({
                data: {
                  requestId,
                  failedProvider: firstProvider.provider as never,
                  failedModelId: firstProvider.model,
                  fallbackProvider: providerName as never,
                  fallbackModelId: model,
                  failureReason: lastError?.message ?? 'unknown',
                  success: true,
                  fallbackLatencyMs: llmResponse.latencyMs,
                },
              })
              .catch(() => {});

            fallbackEventsTotal.inc({
              from_provider: firstProvider.provider,
              to_provider: providerName,
            });
            gatewayMetrics.recordFallback(firstProvider.provider, providerName);
          }

          return {
            response: llmResponse,
            fallbackUsed,
            retryCount,
            providerUsed: providerName,
            modelUsed: model,
          };
        } catch (err) {
          lastError = err as Error;
          await circuitBreaker.recordFailure(providerName, model);
          gatewayMetrics.updateCircuitBreaker(providerName, model, 'OPEN');

          if (this.isNonRetryable(err as Error)) {
            throw err;
          }

          logger.warn(
            { requestId, traceId, attempt, provider: providerName, model, err },
            'Stream provider request failed',
          );
        }
      }
    }

    throw new AppError(
      502,
      'ALL_PROVIDERS_FAILED',
      'All providers failed to process the stream',
      { lastError: lastError?.message },
    );
  }

  private async executeWithRetryAndFallback(
    request: ChatRequest,
    routing: Awaited<ReturnType<typeof routingEngine.route>>,
    workspaceId: string,
    requestId: string,
    traceId: string,
  ) {
    const providers = [
      { provider: routing.provider, model: routing.modelId },
      // Fallback chain: use other available providers
      ...(await this.buildFallbackChain(routing.provider, routing.modelId)),
    ];

    let lastError: Error | null = null;
    let retryCount = 0;
    let fallbackUsed = false;

    for (let i = 0; i < providers.length; i++) {
      const { provider: providerName, model } = providers[i];
      const isFirst = i === 0;
      const maxAttempts = isFirst ? RETRY_CONFIG.MAX_ATTEMPTS : 1;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (attempt > 1) {
          const delay = calculateExponentialBackoff(
            attempt - 1,
            RETRY_CONFIG.BASE_DELAY_MS,
            RETRY_CONFIG.MAX_DELAY_MS,
          );
          logger.info({ requestId, attempt, delay, provider: providerName, model }, 'Retrying');
          await sleep(delay);
          retryCount++;
        }

        try {
          const isOpen = await circuitBreaker.isOpen(providerName, model);
          if (isOpen) {
            throw new Error(`Circuit breaker OPEN for ${providerName}/${model}`);
          }

          const providerClient = providerRegistry.get(providerName);
          const llmStart = Date.now();

          const llmResponse = await providerClient.generate({
            model,
            messages: [
              ...(request.systemPrompt
                ? [{ role: 'system' as const, content: request.systemPrompt }]
                : []),
              { role: 'user' as const, content: request.message },
            ],
            maxTokens: request.maxTokens,
            temperature: request.temperature,
          });

          llmRequestDuration.observe(
            { provider: providerName, model, status: 'success' },
            (Date.now() - llmStart) / 1000,
          );

          await circuitBreaker.recordSuccess(providerName, model);
          gatewayMetrics.updateCircuitBreaker(providerName, model, 'CLOSED');

          const modelEntry = await prisma.modelRegistry.findFirst({
            where: { provider: providerName as never, modelId: model },
          });

          if (modelEntry) {
            prisma.providerLog.create({
              data: {
                requestId,
                modelRegistryId: modelEntry.id,
                attemptNumber:   attempt,
                success:         true,
                latencyMs:       llmResponse.latencyMs,
                inputTokens:     llmResponse.inputTokens,
                outputTokens:    llmResponse.outputTokens,
                costUsd:         providerClient.calculateCost(
                  llmResponse.inputTokens,
                  llmResponse.outputTokens,
                  model,
                ),
              },
            }).catch(() => {});
          }

          // Log fallback event if applicable
          if (!isFirst) {
            fallbackUsed = true;
            const firstProvider = providers[0];
            prisma.fallbackEvent
              .create({
                data: {
                  requestId,
                  failedProvider: firstProvider.provider as never,
                  failedModelId: firstProvider.model,
                  fallbackProvider: providerName as never,
                  fallbackModelId: model,
                  failureReason: lastError?.message ?? 'unknown',
                  success: true,
                  fallbackLatencyMs: llmResponse.latencyMs,
                },
              })
              .catch(() => {});

            fallbackEventsTotal.inc({
              from_provider: firstProvider.provider,
              to_provider: providerName,
            });
            gatewayMetrics.recordFallback(firstProvider.provider, providerName);
          }

          return { response: llmResponse, fallbackUsed, retryCount, providerUsed: providerName, modelUsed: model };
        } catch (err) {
          lastError = err as Error;
          await circuitBreaker.recordFailure(providerName, model);
          gatewayMetrics.updateCircuitBreaker(providerName, model, 'OPEN');

          // Don't retry non-retryable errors
          if (this.isNonRetryable(err as Error)) {
            throw err;
          }

          logger.warn(
            { requestId, traceId, attempt, provider: providerName, model, err },
            'Provider request failed',
          );
        }
      }
    }

    throw new AppError(
      502,
      'ALL_PROVIDERS_FAILED',
      'All providers failed to process the request',
      { lastError: lastError?.message },
    );
  }

  private async buildFallbackChain(
    primaryProvider: string,
    primaryModel: string,
  ): Promise<Array<{ provider: string; model: string }>> {
    const fallbacks = await prisma.modelRegistry.findMany({
      where: {
        isEnabled: true,
        availabilityStatus: { in: ['AVAILABLE', 'DEGRADED'] },
        supportsEmbeddings: false,
        NOT: { provider: primaryProvider as never, modelId: primaryModel },
      },
      orderBy: [{ qualityTier: 'asc' }, { inputCostPerMillion: 'asc' }],
      take: 3,
    });

    return fallbacks.map((m: typeof fallbacks[number]) => ({ provider: m.provider, model: m.modelId }));
  }

  private isNonRetryable(err: Error): boolean {
    const msg = err.message.toLowerCase();
    return (
      msg.includes('400') ||
      msg.includes('401') ||
      msg.includes('403') ||
      msg.includes('invalid api key') ||
      msg.includes('permission')
    );
  }

  private buildResponse(params: {
    requestId: string;
    traceId: string;
    message: string;
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    actualCostUsd: number;
    baselineCostUsd: number;
    savingsUsd: number;
    totalLatencyMs: number;
    providerLatencyMs: number;
    cacheHit: boolean;
    complexityLevel: string;
    complexityScore: number;
    strategy: string;
    fallbackUsed: boolean;
    retryCount: number;
    finishReason: string;
  }): ChatResponse {
    return {
      requestId: params.requestId,
      traceId: params.traceId,
      message: params.message,
      model: params.model,
      provider: params.provider,
      usage: {
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        totalTokens: params.totalTokens,
      },
      cost: {
        actualUsd: params.actualCostUsd,
        baselineUsd: params.baselineCostUsd,
        savingsUsd: params.savingsUsd,
        savingsPercent: calculateSavingsPercent(params.baselineCostUsd, params.actualCostUsd),
      },
      performance: {
        totalLatencyMs: params.totalLatencyMs,
        providerLatencyMs: params.providerLatencyMs,
        cacheHit: params.cacheHit,
      },
      routing: {
        strategy: params.strategy,
        complexityLevel: params.complexityLevel,
        complexityScore: params.complexityScore,
        fallbackUsed: params.fallbackUsed,
        retryCount: params.retryCount,
      },
      finishReason: params.finishReason,
    };
  }
}

export const gatewayService = new GatewayService();
