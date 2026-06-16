import { defineConfig } from '@playwright/test';

/**
 * E2E harness that drives the *real built extension* (.output/chrome-mv3) in a
 * Chromium persistent context. Unlike the gstack `browse` daemon, every run is a
 * single self-contained process, so there is no cross-call daemon to be killed.
 *
 * Run `npm run build` first (or use `npm run test:e2e`, which builds for you).
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1, // one persistent context (one loaded extension) at a time
  reporter: [['list']],
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:5599',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node tests/e2e/fixtures/server.mjs',
    url: 'http://127.0.0.1:5599/chatgpt-like.html',
    reuseExistingServer: true,
    timeout: 10_000,
  },
});
