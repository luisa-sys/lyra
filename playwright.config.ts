import { defineConfig, devices } from '@playwright/test';

// KAN-114: when running against a Vercel-protected deploy URL on CI we
// need to send the bypass header on every request. Locally and in tests
// against http://localhost:3000, the variable is unset and the header
// object is empty — no behaviour change.
const vercelBypass = process.env.VERCEL_AUTOMATION_BYPASS;
const extraHTTPHeaders: Record<string, string> = vercelBypass
  ? { 'x-vercel-protection-bypass': vercelBypass }
  : {};

// KAN-348: the authed suite runs against the deployed dev/stage origin, which
// sits behind Cloudflare bot-management. From a GitHub Actions runner IP that
// serves a "Just a moment…" 403 challenge (CLAUDE.md gotcha #7), so every
// navigation 403s and the suite can never mint a session. The fix is a
// Cloudflare WAF *skip* rule keyed to a secret header this harness sends. Both
// vars must be set (header NAME + SECRET value); unset → empty → no-op, so the
// anon localhost gate and any un-provisioned run are unaffected. See
// buildCfBypassHeader() consumers + the workflow that wires the secrets.
export function buildCfBypassHeader(
  e: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const name = e.E2E_CF_BYPASS_HEADER?.trim();
  const secret = e.E2E_CF_BYPASS_SECRET;
  return name && secret ? { [name]: secret } : {};
}
Object.assign(extraHTTPHeaders, buildCfBypassHeader());

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

// KAN-348: the authenticated journey lives under tests/e2e/authed/ and must NOT
// run in the anon projects (chromium/mobile-safari) — it needs a seeded session.
// The anon PR gate ignores it entirely; the authed project runs only when
// E2E_AUTHED is set (so the cred-free gate is a NO-OP).
const AUTHED_MATCH = /journey\.authed\.spec\.ts/;

// The authed project exists ONLY when E2E_AUTHED is set. Each describe in the
// journey spec picks its own storageState via test.use({ storageState }), so no
// project-level storageState is set here.
const authedProjects = process.env.E2E_AUTHED
  ? [
      {
        name: 'authed-journey',
        testMatch: AUTHED_MATCH,
        use: { ...devices['Desktop Chrome'] },
      },
    ]
  : [];

export default defineConfig({
  testDir: './tests/e2e',
  // KAN-348: globalSetup is a no-op unless E2E_AUTHED is set (see
  // tests/e2e/global-setup.ts) — the anon gate makes zero Supabase calls.
  globalSetup: require.resolve('./tests/e2e/global-setup'),
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
    // Anon projects: explicitly ignore the authed spec so it never runs without
    // a seeded session (would 500 / redirect to /login under dummy env).
    { name: 'chromium', testIgnore: AUTHED_MATCH, use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-safari', testIgnore: AUTHED_MATCH, use: { ...devices['iPhone 14'] } },
    ...authedProjects,
  ],
  webServer,
});