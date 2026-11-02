import { defineConfig } from '@playwright/test';

/**
 * Full-stack acceptance test. Starts the built API, studio, respondent runtime and CAPI app unless they are
 * already running (set E2E_REUSE=1 to use servers you started yourself).
 * Requires a migrated database (DATABASE_URL) and `pnpm build` first.
 */
const env = { ...process.env, ALLOW_SIGNUP: 'true' } as Record<string, string>;
export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: [
    { command: 'node ../apps/api/dist/main.js', url: 'http://localhost:4000/api/health', reuseExistingServer: true, env, timeout: 60_000 },
    { command: 'pnpm --filter @zapx/studio start', url: 'http://localhost:3000/login', reuseExistingServer: true, env, timeout: 120_000 },
    { command: 'pnpm --filter @zapx/runtime preview', url: 'http://localhost:5173', reuseExistingServer: true, env, timeout: 60_000 },
    { command: 'pnpm --filter @zapx/capi preview', url: 'http://localhost:5174', reuseExistingServer: true, env, timeout: 60_000 },
  ],
});
