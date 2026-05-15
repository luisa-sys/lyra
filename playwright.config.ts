import { defineConfig, devices } from '@playwright/test';

// KAN-114: when running against a Vercel-protected deploy URL on CI we
// need to send the bypass header on every request. Locally and in tests
// against http://localhost:3000, the variable is unset and the header
// object is empty — no behaviour change.
const vercelBypass = process.env.VERCEL_AUTOMATION_BYPASS;
const extraHTTPHeaders: Record<string, string> = vercelBypass
  ? { 'x-vercel-protection-bypass': vercelBypass }
  : {};

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
  webServer: process.env.CI ? undefined : {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
  },
});