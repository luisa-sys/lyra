/**
 * KAN-348 — safe authenticated-session mint for the E2E harness.
 *
 * We deliberately do NOT hand-craft the `sb-<ref>-auth-token` cookie. Its
 * `base64-`-prefixed, ~3180-byte-chunked JSON encoding is a @supabase/ssr
 * internal (cookies.js / chunker.js) that can shift across the dependency's
 * version range — a hand-rolled cookie would make the harness silently rotten.
 *
 * Instead we drive the app's OWN confirm route so Supabase writes its cookies
 * exactly as production does:
 *   (a) service-role `admin.auth.admin.generateLink({ type:'magiclink', email })`
 *       returns `properties.hashed_token`;
 *   (b) a fresh Playwright browser context visits
 *       `${baseURL}/auth/confirm?token_hash=<hashed_token>&type=magiclink`
 *       — src/app/auth/confirm/route.ts calls verifyOtp (no PKCE verifier
 *       needed) and redirects through resolvePostLoginRedirect, setting the real
 *       chunked SSR auth cookie;
 *   (c) we wait for the post-login landing then capture `context.storageState()`.
 *
 * The token is single-use and consumed immediately; generateLink is service-role
 * only and guarded to dev/staging (supabase-admin.ts). Nothing here bypasses
 * auth in prod — it all depends on the service-role key, absent in prod.
 */
import { chromium } from '@playwright/test';
import { adminClient } from './supabase-admin';

/**
 * Mint a storageState JSON for `email` by round-tripping a magic-link through
 * the app's /auth/confirm route. Writes the state to `statePath`.
 */
export async function mintSession(
  baseURL: string,
  email: string,
  statePath: string,
): Promise<void> {
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error || !data?.properties?.hashed_token) {
    throw new Error(`generateLink(${email}) failed: ${error?.message ?? 'no hashed_token'}`);
  }
  const hashedToken = data.properties.hashed_token;

  const bypass = process.env.VERCEL_AUTOMATION_BYPASS;
  // Same Cloudflare-bypass header the Playwright config sends (KAN-348): this
  // context is created directly (not from the config `use`), so it must carry
  // the header itself to clear CF bot-management on the /auth/confirm redirect.
  // Both vars unset → empty → no-op.
  const cfName = process.env.E2E_CF_BYPASS_HEADER?.trim();
  const cfSecret = process.env.E2E_CF_BYPASS_SECRET;
  const extraHTTPHeaders: Record<string, string> = {
    ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}),
    ...(cfName && cfSecret ? { [cfName]: cfSecret } : {}),
  };
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      baseURL,
      extraHTTPHeaders: Object.keys(extraHTTPHeaders).length ? extraHTTPHeaders : undefined,
    });
    const page = await context.newPage();

    // Capture the main-frame navigation chain so a failure reports the REAL
    // cause (edge status, Cloudflare challenge, token rejection) instead of
    // guessing at a redirect allowlist. Each hop is {status, url}.
    const nav: Array<{ status: number; url: string }> = [];
    page.on('response', (res) => {
      if (res.request().isNavigationRequest() && res.frame() === page.mainFrame()) {
        nav.push({ status: res.status(), url: res.url() });
      }
    });

    const confirmUrl = `${baseURL.replace(/\/$/, '')}/auth/confirm?token_hash=${encodeURIComponent(
      hashedToken,
    )}&type=magiclink`;
    const gotoResp = await page.goto(confirmUrl, { waitUntil: 'commit' });
    // Post-login routing lands on /dashboard (dev/stage) or /waitlist (prod
    // family). Either proves the session cookie was written. A landing on
    // /login?error=… means the token was rejected — surface that loudly.
    await page.waitForURL(/\/(dashboard|waitlist)/, { timeout: 30_000 }).catch(async () => {
      const url = page.url();
      // Gather concrete evidence: the app + a residential-IP curl both redirect
      // /auth/confirm -> /dashboard fine, so a CI failure here is almost always
      // the EDGE, not the app. Cloudflare bot-management challenges the GitHub
      // Actions runner IP (see CLAUDE.md gotcha #7): the request never reaches
      // the origin, so it neither redirects nor logs a Vercel error.
      const cfRay = gotoResp?.headers()['cf-ray'];
      const server = gotoResp?.headers()['server'];
      const title = await page.title().catch(() => '(no title)');
      const bodySnippet = (await page.evaluate(() => document.body?.innerText ?? '').catch(() => ''))
        .slice(0, 300)
        .replace(/\s+/g, ' ')
        .trim();
      const chain = nav.map((h) => `${h.status} ${h.url}`).join('  ->  ') || '(no navigation responses captured)';
      const looksLikeCfChallenge =
        /cloudflare/i.test(server ?? '') &&
        (/just a moment|attention required|verify you are human|cf-chl|challenge/i.test(
          `${title} ${bodySnippet}`,
        ) ||
          (gotoResp?.status() ?? 0) === 403);
      throw new Error(
        `mintSession(${email}): did not reach /dashboard or /waitlist — landed on ${url}.\n` +
          `  nav chain: ${chain}\n` +
          `  goto status: ${gotoResp?.status() ?? 'n/a'}  server: ${server ?? 'n/a'}  cf-ray: ${cfRay ?? 'n/a'}\n` +
          `  page title: ${title}\n` +
          `  body[0..300]: ${bodySnippet}\n` +
          (looksLikeCfChallenge
            ? '  DIAGNOSIS: Cloudflare bot-management is challenging the CI runner IP (CLAUDE.md gotcha #7). ' +
              'The authed harness must reach the ORIGIN — add a Cloudflare WAF skip rule keyed to a secret ' +
              'header the harness sends, or run against a non-CF-proxied origin whose build is not ' +
              'parent-cookie-scoped to .checklyra.com.'
            : '  If this is not a Cloudflare challenge, inspect the nav chain above: a /login landing means the ' +
              'token was rejected; a bounce back off /dashboard means the session cookie was not persisted.'),
      );
    });
    await context.storageState({ path: statePath });
    await context.close();
  } finally {
    await browser.close();
  }
}
