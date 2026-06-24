/**
 * KAN-274 (epic KAN-273) + SEC-40 (epic SEC-37): cross-subdomain session-cookie
 * scoping.
 *
 * Each environment runs an app host AND a sibling admin host on the same parent
 * domain — `dev.checklyra.com` + `admin-dev.checklyra.com`, `checklyra.com` +
 * `admin.checklyra.com`, etc. For a session established on the app host to be
 * usable on the admin host (SEC-37), the Supabase auth cookie must be scoped to
 * the shared parent `.checklyra.com`. We therefore scope to `.checklyra.com` on
 * EVERY real checklyra.com environment (dev / stage / beta / prod) — not just
 * prod + beta as originally (KAN-274). This is the same mechanism that already
 * lets `checklyra.com -> admin.checklyra.com` work on prod.
 *
 * Cross-ENVIRONMENT isolation is preserved by the Supabase cookie NAME embedding
 * the project ref (`sb-<ref>-auth-token`): a dev session cookie is now *sent* to
 * prod/stage hosts, but each env's client only reads its own ref's cookie, so a
 * session can never authenticate across environments. (KAN-274 additionally
 * host-scoped dev/stage as belt-and-suspenders; the ref-in-name is the real
 * guard, and the SEC-37 admin-subdomain requirement makes parent-scoping
 * necessary — `admin-dev` is a *sibling* of `dev`, so the only shared parent is
 * `.checklyra.com`.)
 *
 * Detection (no new env vars): NEXT_PUBLIC_SITE_URL is set per env to that env's
 * checklyra.com URL (dev/stage/beta/prod). Previews (`*.vercel.app`) leave it
 * unset and local uses `localhost` — both stay host-scoped, because a
 * `.checklyra.com` domain wouldn't match those hosts (the browser would drop the
 * cookie). IS_BETA_DEPLOY stays as a defensive short-circuit. SameSite + Secure
 * are left as Supabase sets them (Lax + Secure).
 */
export const PROD_SITE_URL = 'https://checklyra.com';
export const PARENT_COOKIE_DOMAIN = '.checklyra.com';

/** True when `host` is checklyra.com or any subdomain of it. */
function isChecklyraHost(host: string): boolean {
  return host === 'checklyra.com' || host.endsWith('.checklyra.com');
}

/**
 * The cookie `domain` to use, or undefined to stay host-scoped (preview/local).
 * Parent-scoped on every real checklyra.com env so the app host and its sibling
 * admin host share one session (SEC-40 / SEC-37).
 */
export function parentCookieDomain(e: NodeJS.ProcessEnv = process.env): string | undefined {
  // Defensive: beta always shares, even if NEXT_PUBLIC_SITE_URL ever drifted.
  if (e.IS_BETA_DEPLOY === 'true') return PARENT_COOKIE_DOMAIN;
  const raw = e.NEXT_PUBLIC_SITE_URL;
  if (!raw) return undefined;
  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    return undefined;
  }
  return isChecklyraHost(host) ? PARENT_COOKIE_DOMAIN : undefined;
}

/**
 * Merge the parent-domain into a cookie-options object when on prod/beta;
 * leave it untouched (host-scoped) on dev/stage/local. Pure — returns a new
 * object only when a domain is actually added.
 */
export function withParentCookieDomain<T extends object>(
  options: T,
  e: NodeJS.ProcessEnv = process.env,
): T | (T & { domain: string }) {
  const domain = parentCookieDomain(e);
  return domain ? { ...options, domain } : options;
}
