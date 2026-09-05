import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals:     true,
    environment: 'node',
    coverage: {
      provider:  'v8',
      reporter:  ['text', 'json', 'html'],
      include:   ['src/**/*.ts'],
      exclude:   ['src/index.ts', 'src/**/*.d.ts'],
    },
    // Isolate each test file to avoid shared state
    isolate:  true,
    // Only run tests matching __tests__/**
    include:  ['src/__tests__/**/*.test.ts'],
    setupFiles: ['src/__tests__/setup.ts'],
  },
  resolve: {
    alias: {
      '@smartroute/shared':   path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@smartroute/database': path.resolve(__dirname, '../../packages/database/src/index.ts'),
    },
  },
});
