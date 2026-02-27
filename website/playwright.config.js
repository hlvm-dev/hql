import { defineConfig } from '@playwright/test';

const isCI = !!process.env.CI;
const ciPort = Number(process.env.PLAYWRIGHT_CI_PORT || 5173);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: isCI ? 1 : 0,
  use: {
    baseURL: isCI ? `http://127.0.0.1:${ciPort}` : 'http://127.0.0.1:5173',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: isCI
      ? `npm run preview -- --host 127.0.0.1 --port ${ciPort}`
      : 'npm run dev -- --host 127.0.0.1 --port 5173',
    port: isCI ? ciPort : 5173,
    reuseExistingServer: !isCI,
    timeout: 15_000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
