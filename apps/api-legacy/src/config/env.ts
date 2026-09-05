import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Load monorepo root .env, then apps/api/.env overrides (when present).
const repoRootEnv = resolve(__dirname, '../../../../.env');
const apiEnv = resolve(__dirname, '../../.env');

if (existsSync(repoRootEnv)) {
  loadDotenv({ path: repoRootEnv });
}
if (existsSync(apiEnv)) {
  loadDotenv({ path: apiEnv, override: true });
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_NAME: z.string().default('SmartRoute AI'),
  APP_VERSION: z.string().default('0.1.0'),

  // Server
  API_PORT: z.coerce.number().int().min(1024).default(3001),
  API_HOST: z.string().default('0.0.0.0'),
  API_BASE_URL: z.string().url().default('http://localhost:3001'),

  // Database
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).optional(),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().default(0),

  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // API key encryption
  API_KEY_ENCRYPTION_SECRET: z.string().min(32),

  // LLM Providers (all optional at startup, validated at request time)
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  COHERE_API_KEY: z.string().optional(),
  MISTRAL_API_KEY: z.string().optional(),
  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),

  // Cache
  SEMANTIC_CACHE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.92),
  CACHE_TTL_SECONDS: z.coerce.number().int().default(3600),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().default(60_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().default(100),
  MAX_INFLIGHT_REQUESTS: z.coerce.number().int().default(500),

  // Email (SMTP)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().email().optional(),
  REQUIRE_EMAIL_VERIFICATION: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // Stripe billing
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_PRO: z.string().optional(),
  STRIPE_PRICE_ENTERPRISE: z.string().optional(),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  OAUTH_REDIRECT_URI: z.string().url().optional(),

  // Queue concurrency
  QUEUE_CONCURRENCY_ANALYTICS: z.coerce.number().int().default(5),
  QUEUE_CONCURRENCY_EMBEDDINGS: z.coerce.number().int().default(3),
  QUEUE_CONCURRENCY_HEALTH_CHECKS: z.coerce.number().int().default(2),

  // Observability
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  PROMETHEUS_PORT: z.coerce.number().int().default(9091),

  // CORS
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
});

function loadEnv() {
  const result = EnvSchema.safeParse(process.env);

  if (!result.success) {
    const missing = result.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`❌ Invalid environment variables:\n${missing}`);
  }

  return result.data;
}

export const env = loadEnv();
export type Env = typeof env;
