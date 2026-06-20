/**
 * KAN-274 (epic KAN-273): cross-domain session-cookie scoping.
 *
 * To let a checklyra.com (prod) session carry over to beta.checklyra.com
 * without a re-login, the Supabase auth cookies are scoped to the parent
 * domain `.checklyra.com` — but ONLY on prod + beta. dev (dev.checklyra.com)
 * and stage (stage.checklyra.com) use DIFFERENT Supabase projects and MUST
 * stay host-scoped, so a session can never be read across environments.
 *
 * Detection (no new env vars — reuses existing wiring):
 *   - beta: IS_BETA_DEPLOY === 'true'
 *   - prod: NEXT_PUBLIC_SITE_URL === 'https://checklyra.com'
 *   - everything else (dev / stage / preview / local) → host-scoped (undefined).
 *
 * Defence in depth: the Supabase cookie NAME embeds the project ref, so even a
 * misconfigured domain cannot let prod/beta (shared prod-lyra ref) collide with
 * dev/stage (different refs). SameSite + Secure are left as Supabase sets them
 * (Lax + Secure) — correct for a same-site top-level navigation between
 * checklyra.com and beta.checklyra.com.
 */
export const PROD_SITE_URL = 'https://checklyra.com';
export const PARENT_COOKIE_DOMAIN = '.checklyra.com';

/** The cookie `domain` to use, or undefined to stay host-scoped (dev/stage/local). */
export function parentCookieDomain(e: NodeJS.ProcessEnv = process.env): string | undefined {
  const isBeta = e.IS_BETA_DEPLOY === 'true';
  const isProd = e.NEXT_PUBLIC_SITE_URL === PROD_SITE_URL;
  return isBeta || isProd ? PARENT_COOKIE_DOMAIN : undefined;
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
