import { defineConfig } from 'vitest/config';

/** Deliberately red in Phase 1; never use skip/todo/fails to hide missing extractors. */
export default defineConfig({ test: {
  include: ['infrastructure/core/static-analysis/__tests__/*.integration.ts'],
  fileParallelism: false,
  // Bound V8's heap so collection occurs before the 2 GiB process RSS ceiling.
  execArgv: ['--max-old-space-size=1728'],
  testTimeout: 120_000,
  hookTimeout: 120_000,
} });
