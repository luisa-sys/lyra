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
   * Falls back to the issuer's own MCP host when unset so a misconfigured
   * environment still mints a bound token rather than crashing or, worse,
   * minting an unbound one.
   */
  allowedResources: (): string[] => {
    const raw = env.oauthAllowedResources()
      .split(',')
      .map((s) => s.trim().replace(/\/$/, ''))
      .filter(Boolean);
    return raw.length > 0 ? raw : [`${siteUrl().replace('://', '://mcp-')}/mcp`];
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
