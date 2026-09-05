/**
 * Global Vitest setup — runs before all test files.
 *
 * We set required env vars so the config module can parse without throwing.
 * Each test module that needs a real DB or Redis must provide its own mock.
 */

import { vi } from 'vitest';

// ── Minimal env vars ──────────────────────────────────────────
process.env.NODE_ENV               = 'test';
process.env.DATABASE_URL           = 'postgresql://test:test@localhost:5432/test';
process.env.DIRECT_URL             = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL              = 'redis://localhost:6379';
process.env.REDIS_HOST             = 'localhost';
process.env.REDIS_PORT             = '6379';
process.env.JWT_SECRET             = 'test-jwt-secret-32-bytes-minimum!!';
process.env.JWT_REFRESH_SECRET     = 'test-refresh-secret-32-bytes-min!';
process.env.JWT_EXPIRES_IN         = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
process.env.API_KEY_ENCRYPTION_SECRET = 'test-aes-secret-32bytesminimum!!!';
process.env.API_PORT               = '3001';
process.env.CORS_ORIGINS           = 'http://localhost:3000';
process.env.LOG_LEVEL              = 'error'; // lowest noise; 'silent' not in enum
process.env.SAML_E2E_BYPASS        = 'true'; // Playwright ACS bypass (see docs/SSO.md)
process.env.OAUTH_E2E_BYPASS       = 'true'; // Playwright Google OAuth bypass

// ── Silence pino during tests ────────────────────────────────
vi.mock('../config/logger', () => ({
  logger: {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}));
