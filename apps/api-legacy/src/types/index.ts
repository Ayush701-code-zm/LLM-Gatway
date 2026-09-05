import type { Request } from 'express';
import type { JwtPayload } from 'jsonwebtoken';
import type { ComplexityLevel } from '../engines/complexityClassifier';

export type { ComplexityLevel };

// ===========================================================
// Augment Express Request with auth context
// ===========================================================

export interface AuthPayload extends JwtPayload {
  sub: string;        // user id
  workspaceId: string;
  email: string;
  role: string;
}

export interface ApiKeyContext {
  id: string;
  workspaceId: string;
  scopes: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
      apiKey?: ApiKeyContext;
      requestId: string;
      traceId: string;
      startTime: number;
    }
  }
}

// ===========================================================
// Provider types
// ===========================================================

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMRequest {
  messages: LLMMessage[];
  model: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface LLMResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  finishReason: string;
  latencyMs: number;
  model: string;
  provider: string;
  rawResponse?: unknown;
}

export interface LLMStreamChunk {
  content: string;
  done: boolean;
  finishReason?: string;
}

export interface ProviderHealthResult {
  provider: string;
  model: string;
  status: 'available' | 'degraded' | 'unavailable';
  latencyMs: number;
  errorMessage?: string;
}

// ===========================================================
// Routing types
// ===========================================================

export interface RoutingContext {
  workspaceId: string;
  prompt: string;
  requestedModel: string;
  stream?: boolean;
}

export interface RoutingResult {
  provider: string;
  modelId: string;
  modelRegistryId: string;
  complexityLevel: string;
  complexityScore: number;
  strategy: string;
  selectionReason: string;
  estimatedCostUsd: number;
  decisionLatencyMs: number;
  candidateModels: CandidateModel[];
}

export interface CandidateModel {
  provider: string;
  modelId: string;
  estimatedCostUsd: number;
  reason: string;
  selected: boolean;
}

// ===========================================================
// Cache types
// ===========================================================

export interface CacheCheckResult {
  hit: boolean;
  response?: string;
  cacheEntryId?: string;
  similarityScore?: number;
  latencyMs: number;
  savingsUsd?: number;
}

// ===========================================================
// Circuit breaker types
// ===========================================================

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerStatus {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureAt?: Date;
  nextAttemptAt?: Date;
}
