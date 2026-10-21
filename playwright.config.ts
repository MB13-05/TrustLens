import { defineConfig, devices } from '@playwright/test';

/**
 * Two servers: the regular dev server (synthetic demo flows, no secrets needed) and a fixture server that runs the real UI
 * and API in live mode with deterministic adapters (tests/e2e-server.ts). Viewports cover desktop, a phone and 320 px.
 */
export default defineConfig({
  testDir: './tests',
  testMatch: ['ui.spec.ts', 'live-flows.spec.ts'],
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3000', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
    { name: 'narrow-320', use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true } },
  ],
  webServer: [
    { command: 'npm run dev', url: 'http://127.0.0.1:3000', reuseExistingServer: !process.env.CI, timeout: 60_000 },
    { command: 'npx tsx tests/e2e-server.ts', url: 'http://127.0.0.1:3100', reuseExistingServer: !process.env.CI, timeout: 60_000 },
  ],
});
