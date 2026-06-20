import { defineConfig, devices } from '@playwright/test';

// KAN-114: when running against a Vercel-protected deploy URL on CI we
// need to send the bypass header on every request. Locally and in tests
// against http://localhost:3000, the variable is unset and the header
// object is empty — no behaviour change.
const vercelBypass = process.env.VERCEL_AUTOMATION_BYPASS;
const extraHTTPHeaders: Record<string, string> = vercelBypass
  ? { 'x-vercel-protection-bypass': vercelBypass }
  : {};

// KAN-271: webServer resolution across the three ways this suite runs:
//
//   1. PR gate (e2e-tests.yml): E2E_LOCAL_SERVER=1 — Playwright builds-then-
//      serves the app itself via `next start` and targets localhost. Used to
//      assert the redesign on a locally-served build without any deployed URL.
//   2. Staging job (deploy-staging.yml): CI is set, BASE_URL points at the
//      just-deployed Vercel URL, E2E_LOCAL_SERVER is unset → NO webServer
//      (we test the real deploy, not a local build). Unchanged from KAN-114.
//   3. Local dev: nothing set → `npm run dev`, reuse an already-running server.
//
// In CI we DON'T let Playwright run the build inside `webServer.command`
// (that would race the 120s startup timeout); the workflow runs `next build`
// as its own step and only `next start` is launched here.
const webServer = process.env.E2E_LOCAL_SERVER
  ? {
      command: 'npm run start',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    }
  : process.env.CI
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
      };

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }], ['github'], ['list']],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    extraHTTPHeaders,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 14'] } },
  ],
  webServer,
});