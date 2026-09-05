import { z } from 'zod';
import { isReservedWorkspaceSlug } from '../constants/index';

// ===========================================================
// Generic API Response wrapper
// ===========================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: ResponseMeta;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export interface ResponseMeta {
  requestId: string;
  timestamp: string;
  version: string;
  latencyMs?: number;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// ===========================================================
// Chat API
// ===========================================================

export const ChatRequestSchema = z.object({
  message: z.string().min(1).max(32000),
  systemPrompt: z.string().max(8000).optional(),
  model: z.string().default('auto'),
  stream: z.boolean().default(false),
  maxTokens: z.number().int().min(1).max(32000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  metadata: z.record(z.string()).optional(),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export interface ChatResponse {
  requestId: string;
  traceId: string;
  message: string;
  model: string;
  provider: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  cost: {
    actualUsd: number;
    baselineUsd: number;
    savingsUsd: number;
    savingsPercent: number;
  };
  performance: {
    totalLatencyMs: number;
    providerLatencyMs: number;
    cacheHit: boolean;
  };
  routing: {
    strategy: string;
    complexityLevel: string;
    complexityScore: number;
    fallbackUsed: boolean;
    retryCount: number;
  };
  finishReason: string;
}

// ===========================================================
// Auth API
// ===========================================================

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

/** Lowercase URL slug for SSO discovery and workspace identity. */
export const WorkspaceSlugSchema = z
  .string()
  .min(3)
  .max(40)
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/,
    'Slug must be 3–40 lowercase letters, numbers, or hyphens',
  )
  .refine((slug) => !isReservedWorkspaceSlug(slug), 'Slug is reserved and cannot be used');

export const RegisterSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  workspaceName: z.string().min(2).max(100).optional(),
  workspaceSlug: WorkspaceSlugSchema.optional(),
});

export type LoginRequest = z.infer<typeof LoginSchema>;
export type RegisterRequest = z.infer<typeof RegisterSchema>;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  workspaces: Array<{
    id: string;
    slug: string;
    name: string;
    role: string;
  }>;
}

// ===========================================================
// API Key API
// ===========================================================

export const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  expiresAt: z.string().datetime().optional(),
  scopes: z.array(z.string()).default(['chat:write', 'analytics:read']),
  rateLimitRpm: z.number().int().min(1).optional(),
  rateLimitTpm: z.number().int().min(1).optional(),
});

export type CreateApiKeyRequest = z.infer<typeof CreateApiKeySchema>;
