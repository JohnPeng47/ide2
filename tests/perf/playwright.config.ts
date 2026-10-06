import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'f02-canvas.spec.ts',
  outputDir: '.results',
  retries: 0,
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['json', { outputFile: '.results/report.json' }]],
  use: {
    actionTimeout: 15_000,
    browserName: 'chromium',
    viewport: { width: 1800, height: 1100 },
    headless: true,
    launchOptions: { executablePath: process.env.CHROME_PATH },
    // Tracing/video alter frame timings; screenshots are taken after measurement.
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
  },
});
