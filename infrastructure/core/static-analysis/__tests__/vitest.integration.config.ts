import { defineConfig } from 'vitest/config';

/** Deliberately red in Phase 1; never use skip/todo/fails to hide missing extractors. */
export default defineConfig({ test: {
  include: ['infrastructure/core/static-analysis/__tests__/*.integration.ts'],
  fileParallelism: false,
  testTimeout: 120_000,
  hookTimeout: 120_000,
} });
