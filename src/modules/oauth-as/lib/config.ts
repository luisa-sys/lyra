import { env } from '@/modules/platform/env';
/**
 * OAuth 2.1 server configuration — KAN-88.
 *
 * Single source of truth for issuer URL, supported scopes, TTLs, and
 * endpoint paths. Everything is environment-driven so dev/staging/prod
 * advertise the right URLs in their well-known metadata.
 */

function siteUrl(): string {
  // Production deploy: NEXT_PUBLIC_SITE_URL is set by the deploy workflow.
  // Preview / dev: fall back to VERCEL_URL if NEXT_PUBLIC_SITE_URL isn't set
  // (Vercel injects VERCEL_URL automatically on every deploy).
  const url = process.env.NEXT_PUBLIC_SITE_URL || process.env.LYRA_SITE_URL;
  if (url) return url.replace(/\/$/, '');
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return 'https://checklyra.com';
}

/**
 * SEC-46 — the real MCP resource URI for each deployed site host.
 *
 * Keyed on the SITE host (the authorization server's own origin), because that
 * is what an incoming request tells us. Note `beta` and `prod` map to the SAME
 * resource: they share one MCP server and one Supabase project. That is why
 * this cannot be a string transform.
 *
 * `stage` has no MCP server by design — staging is engineering-only and does
 * not expose MCP integrations — so its entry is a placeholder that exists only
 * so the environment mints a *bound* token instead of an unbound one. No client
 * can present it, which is the correct outcome there.
 */
const MCP_RESOURCE_BY_SITE_HOST: Readonly<Record<string, string>> = {
  'checklyra.com': 'https://mcp.checklyra.com/mcp',
  'www.checklyra.com': 'https://mcp.checklyra.com/mcp',
  'beta.checklyra.com': 'https://mcp.checklyra.com/mcp',
  'dev.checklyra.com': 'https://mcp-dev.checklyra.com/mcp',
  'stage.checklyra.com': 'https://mcp-stage.checklyra.com/mcp',
};

/**
 * Resolve the default resource for a site URL. Unknown hosts — Vercel preview
 * deployments, most importantly — resolve to the DEV MCP, because a preview
 * build runs against the dev Supabase project and dev is the only MCP whose
 * `api_keys` table could ever recognise it (gotcha #19).
 *
 * Exported for tests: this is the function that was wrong, so it is the
 * function that gets asserted directly rather than through two layers of env.
 */
export function defaultResourceForSite(site: string): string {
  const withoutSlash = site.replace(/\/$/, '');
  let host: string;
  try {
    host = new URL(withoutSlash).host.toLowerCase();
  } catch {
    // Not a parseable URL. Fail towards dev rather than towards production:
    // minting a dev-bound token in a confused environment is recoverable,
    // handing out a production-bound one is not.
    return MCP_RESOURCE_BY_SITE_HOST['dev.checklyra.com'];
  }
  return MCP_RESOURCE_BY_SITE_HOST[host] ?? MCP_RESOURCE_BY_SITE_HOST['dev.checklyra.com'];
}

export const oauthConfig = {
  issuer: () => siteUrl(),
  authorizationEndpoint: () => `${siteUrl()}/oauth/authorize`,
  tokenEndpoint: () => `${siteUrl()}/oauth/token`,
  registrationEndpoint: () => `${siteUrl()}/oauth/register`,
  revocationEndpoint: () => `${siteUrl()}/oauth/revoke`,
  // SEC-33: RS256 + JWKS. The AS signs with an RS256 private key and publishes
  // the public key here so resource servers verify with no shared secret.
  jwksUri: () => `${siteUrl()}/.well-known/jwks.json`,

  // Scope catalogue. MVP = single 'lyra:full' scope. Granular scopes
  // (lyra:profile:read, lyra:convene:write, etc.) come later.
  supportedScopes: ['lyra:full'] as const,

  /**
   * SEC-46 Phase C — RFC 8707 resource indicators.
   *
   * The canonical resource URIs this AS will mint tokens for. A `resource`
   * parameter at /oauth/authorize must be one of these EXACTLY (after a
   * trailing-slash strip); anything else is `invalid_target`.
   *
   * ⚠️ Membership is an allow-list, never a parse-and-trust. `resource` is an
   * attacker-controlled string that ends up in a signed `aud` claim, and the
   * whole point of binding it is that a token for one resource cannot be
   * replayed at another. A prefix or substring test would hand that back.
   *
   * Order matters: the FIRST entry is the default when a client sends no
   * `resource` at all. That default is what keeps non-RFC-8707 clients working
   * — they still receive a correctly-bound token rather than an unbound one,
   * which is why enforcement on the resource servers can be turned on without
   * waiting for every client to learn the parameter.
   *
   * Configure per environment (comma-separated), user MCP first:
   *   prod/beta  https://mcp.checklyra.com/mcp,https://admin-mcp.checklyra.com/mcp
   *   dev        https://mcp-dev.checklyra.com/mcp
   *
   * Falls back to the issuer's real MCP host when unset, so a misconfigured
   * environment still mints a bound token rather than crashing or, worse,
   * minting an unbound one.
   *
   * ⚠️ THE FALLBACK IS A LOOKUP, NOT A STRING TRANSFORM — and the transform it
   * replaces was wrong on three of four environments.
   *
   * The first cut derived the host as `siteUrl().replace('://', '://mcp-')`.
   * That is correct for dev (`dev.checklyra.com` -> `mcp-dev.checklyra.com`)
   * and WRONG everywhere else: production yielded `mcp-checklyra.com`, a host
   * that does not exist, and beta yielded `mcp-beta.checklyra.com` when beta
   * shares production's MCP. Because it was right on the only environment it
   * was exercised against, it looked fine.
   *
   * Two consequences, and the first is a live regression rather than a latent
   * one. The MCP authorization spec requires clients to send `resource`, and an
   * unknown `resource` is REJECTED here by design — so a client sending the
   * genuine `https://mcp.checklyra.com/mcp` would have been refused
   * `invalid_target` and the OAuth flow would have broken outright. (Before
   * SEC-46 Phase C, `resource` was ignored entirely, so this would have been a
   * regression introduced by the very change meant to harden the flow.) Second,
   * every token minted without an explicit `resource` would carry a bogus `aud`
   * and 401 the moment `OAUTH_AUDIENCE_CHECK` is turned on.
   *
   * The topology is not derivable from the site host by any rule — beta and
   * production deliberately share ONE MCP (and one Supabase project), while
   * staging has no MCP at all by design (CLAUDE.md gotcha #19). So it is
   * written down.
   */
  allowedResources: (): string[] => {
    const raw = env.oauthAllowedResources()
      .split(',')
      .map((s) => s.trim().replace(/\/$/, ''))
      .filter(Boolean);
    if (raw.length > 0) return raw;
    return [defaultResourceForSite(siteUrl())];
  },
  defaultResource: (): string => oauthConfig.allowedResources()[0],

  // Code lifetime — short per OAuth 2.1 (codes must be ≤ 10min).
  authorizationCodeTtlSeconds: 10 * 60,
  // Access token lifetime. SEC-46: 60m -> 15m. Founder-approved 2026-08-16.
  //
  // This is the window between a token leaking and it dying on its own. It used
  // to be the ONLY thing that ever ended a token's life, because revocation was
  // never actually enabled on any resource server (SEC-46 Phase A) — so "revoke
  // access" did nothing for up to an hour. Phase A fixed that; shortening the
  // TTL narrows what is left.
  //
  // Transparent to clients: refresh rotation already works, so a connector just
  // refreshes 4x more often. At 2 registered clients that is negligible traffic.
  accessTokenTtlSeconds: 15 * 60,
  // Refresh token lifetime — 30d.
  refreshTokenTtlSeconds: 30 * 24 * 60 * 60,
};

/**
 * Bearer-realm string used in WWW-Authenticate headers when auth fails.
 * Per RFC 6750 + the MCP authorization spec, this points the client at
 * the AS so it can discover the OAuth flow.
 */
export function wwwAuthenticateHeader(opts: { error?: string; errorDescription?: string } = {}): string {
  const parts = [`Bearer realm="${oauthConfig.issuer()}"`];
  if (opts.error) parts.push(`error="${opts.error}"`);
  if (opts.errorDescription) parts.push(`error_description="${opts.errorDescription}"`);
  return parts.join(', ');
}
