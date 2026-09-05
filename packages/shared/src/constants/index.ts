// ===========================================================
// Plan limits
// ===========================================================

export const PLAN_LIMITS = {
  FREE: {
    requestsPerMinute: 10,
    requestsPerHour: 100,
    requestsPerDay: 500,
    tokensPerMinute: 50_000,
    tokensPerDay: 1_000_000,
    maxWorkspaceMembers: 1,
    maxApiKeys: 2,
    budgetLimitUsd: 10,
  },
  PRO: {
    requestsPerMinute: 60,
    requestsPerHour: 1_000,
    requestsPerDay: 10_000,
    tokensPerMinute: 500_000,
    tokensPerDay: 10_000_000,
    maxWorkspaceMembers: 10,
    maxApiKeys: 20,
    budgetLimitUsd: 500,
  },
  ENTERPRISE: {
    requestsPerMinute: 1_000,
    requestsPerHour: 50_000,
    requestsPerDay: 500_000,
    tokensPerMinute: 5_000_000,
    tokensPerDay: 100_000_000,
    maxWorkspaceMembers: -1, // unlimited
    maxApiKeys: -1,
    budgetLimitUsd: -1,
  },
} as const;

// ===========================================================
// Budget thresholds
// ===========================================================

export const BUDGET_THRESHOLDS = {
  WARNING: 0.8,
  CRITICAL: 0.9,
  BLOCKED: 1.0,
} as const;

// ===========================================================
// Semantic cache
// ===========================================================

export const CACHE_DEFAULTS = {
  SIMILARITY_THRESHOLD: 0.92,
  TTL_SECONDS: 3600,
  EMBEDDING_DIMENSIONS: 1536,
  EMBEDDING_MODEL: 'text-embedding-3-small',
} as const;

// ===========================================================
// Circuit breaker
// ===========================================================

export const CIRCUIT_BREAKER = {
  FAILURE_THRESHOLD: 5,
  SUCCESS_THRESHOLD: 2,
  TIMEOUT_MS: 60_000,
  HALF_OPEN_MAX_CALLS: 3,
} as const;

// ===========================================================
// Retry config
// ===========================================================

export const RETRY_CONFIG = {
  MAX_ATTEMPTS: 3,
  BASE_DELAY_MS: 1_000,
  MAX_DELAY_MS: 10_000,
  JITTER_FACTOR: 0.2,
  RETRYABLE_STATUS_CODES: [429, 500, 502, 503, 504],
  NON_RETRYABLE_STATUS_CODES: [400, 401, 403, 404, 422],
} as const;

// ===========================================================
// Complexity classification thresholds
// ===========================================================

export const COMPLEXITY_THRESHOLDS = {
  SIMPLE_MAX_SCORE: 0.12,  // scores below this → SIMPLE
  MEDIUM_MAX_SCORE: 0.40,  // scores 0.12–0.40 → MEDIUM; above → COMPLEX
} as const;

// ===========================================================
// API versioning
// ===========================================================

export const API_VERSION = 'v1';
export const API_PREFIX = `/api/${API_VERSION}`;

// ===========================================================
// Error codes
// ===========================================================

export const ERROR_CODES = {
  // Auth
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  INVALID_API_KEY: 'INVALID_API_KEY',

  // Rate limiting
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  TOKEN_LIMIT_EXCEEDED: 'TOKEN_LIMIT_EXCEEDED',

  // Budget
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  BUDGET_NOT_FOUND: 'BUDGET_NOT_FOUND',

  // Provider
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  ALL_PROVIDERS_FAILED: 'ALL_PROVIDERS_FAILED',

  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_REQUEST: 'INVALID_REQUEST',

  // General
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// ===========================================================
// Workspace slugs
// ===========================================================

/** Slugs that collide with routes, auth paths, or platform keywords. */
export const RESERVED_WORKSPACE_SLUGS = new Set([
  'admin',
  'api',
  'app',
  'assets',
  'auth',
  'dashboard',
  'docs',
  'health',
  'login',
  'oauth',
  'register',
  'saml',
  'scim',
  'settings',
  'static',
  'support',
  'www',
]);

export function isReservedWorkspaceSlug(slug: string): boolean {
  return RESERVED_WORKSPACE_SLUGS.has(slug.toLowerCase());
}

export const MODEL_PRICING_CATALOG = [
  { provider: 'OPENAI',    modelId: 'gpt-4o',              inputCostPerMillion: 2.50,  outputCostPerMillion: 10.00 },
  { provider: 'OPENAI',    modelId: 'gpt-4o-mini',         inputCostPerMillion: 0.15,  outputCostPerMillion: 0.60 },
  { provider: 'ANTHROPIC', modelId: 'claude-3-5-sonnet-20241022', inputCostPerMillion: 3.00, outputCostPerMillion: 15.00 },
  { provider: 'ANTHROPIC', modelId: 'claude-3-5-haiku-20241022',  inputCostPerMillion: 0.80, outputCostPerMillion: 4.00 },
  { provider: 'GOOGLE',    modelId: 'gemini-2.0-flash-001', inputCostPerMillion: 0.10, outputCostPerMillion: 0.40 },
  { provider: 'GOOGLE',    modelId: 'gemini-1.5-flash',     inputCostPerMillion: 0.075, outputCostPerMillion: 0.30 },
  { provider: 'GOOGLE',    modelId: 'gemini-1.5-pro',       inputCostPerMillion: 3.50,  outputCostPerMillion: 10.50 },
  { provider: 'COHERE',    modelId: 'command-r-plus',       inputCostPerMillion: 2.50,  outputCostPerMillion: 10.00 },
  { provider: 'COHERE',    modelId: 'command-r',            inputCostPerMillion: 0.15,  outputCostPerMillion: 0.60 },
  { provider: 'MISTRAL',   modelId: 'mistral-large-latest', inputCostPerMillion: 2.00,  outputCostPerMillion: 6.00 },
  { provider: 'MISTRAL',   modelId: 'mistral-small-latest', inputCostPerMillion: 0.20,  outputCostPerMillion: 0.60 },
  { provider: 'OLLAMA',    modelId: 'llama3.2:3b',          inputCostPerMillion: 0.001, outputCostPerMillion: 0.001 },
] as const;
