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
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      baseURL,
      extraHTTPHeaders: bypass ? { 'x-vercel-protection-bypass': bypass } : undefined,
    });
    const page = await context.newPage();
    const confirmUrl = `${baseURL.replace(/\/$/, '')}/auth/confirm?token_hash=${encodeURIComponent(
      hashedToken,
    )}&type=magiclink`;
    await page.goto(confirmUrl, { waitUntil: 'commit' });
    // Post-login routing lands on /dashboard (dev/stage) or /waitlist (prod
    // family). Either proves the session cookie was written. A landing on
    // /login?error=… means the token was rejected — surface that loudly.
    await page.waitForURL(/\/(dashboard|waitlist)/, { timeout: 30_000 }).catch(async () => {
      const url = page.url();
      throw new Error(
        `mintSession(${email}): did not reach /dashboard or /waitlist after confirm — landed on ${url}. ` +
          'Check the target env Supabase Auth redirect allowlist includes this BASE_URL /auth/confirm.',
      );
    });
    await context.storageState({ path: statePath });
    await context.close();
  } finally {
    await browser.close();
  }
}
