import { defineConfig } from '@playwright/test';

const runE2E = process.env.RUN_E2E === '1';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:4173',
    trace: 'on-first-retry'
  },
  webServer: runE2E ? {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    port: 4173,
    reuseExistingServer: true
  } : undefined
});

