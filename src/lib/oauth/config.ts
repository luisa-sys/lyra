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
  // For MVP we don't expose JWKS — HS256 with shared secret. RS256 + JWKS
  // is a follow-up. The AS metadata still has to omit the jwks_uri field
  // gracefully so claude.ai doesn't reject us.

  // Scope catalogue. MVP = single 'lyra:full' scope. Granular scopes
  // (lyra:profile:read, lyra:convene:write, etc.) come later.
  supportedScopes: ['lyra:full'] as const,

  // Code lifetime — short per OAuth 2.1 (codes must be ≤ 10min).
  authorizationCodeTtlSeconds: 10 * 60,
  // Access token lifetime — 1h industry standard.
  accessTokenTtlSeconds: 60 * 60,
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
