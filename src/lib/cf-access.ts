/**
 * SEC-34 / SEC-37 — app-layer Cloudflare Access verification for the admin
 * console (defence in depth). Mirrors `lyra-admin-mcp-server/src/cf-access.ts`,
 * adapted for the Next.js **edge** middleware (jose only — Web Crypto, edge-safe).
 *
 * Cloudflare Access, in front of the admin host, stamps every request that
 * passes its policy with a signed `Cf-Access-Jwt-Assertion` JWT. Verifying that
 * JWT *inside the app* means a request that reaches the Vercel origin WITHOUT
 * transiting the CF edge — a leaked `*.vercel.app` preview URL, a spoofed `Host`
 * header straight to the origin, or `/admin` on the public domain — is rejected
 * even though CF Access only fronts the admin hostname. Without this, the edge
 * gate is bypassable and therefore theatre (see SEC-37).
 *
 * INERT until configured: with `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` unset
 * the verifier allows everything, so local dev and any env without the CF app
 * keep working and shipping this is non-breaking. Once both are set it enforces.
 * Env is read at call-time (not module-load) so per-env config + tests work.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';

function rawTeam(): string | undefined {
  return process.env.CF_ACCESS_TEAM_DOMAIN;
}
function audience(): string | undefined {
  return process.env.CF_ACCESS_AUD;
}

/** True iff both CF Access env vars are present → verification is enforced. */
export function cfAccessEnabled(): boolean {
  return Boolean(rawTeam() && audience());
}

/** Accept either "yourteam" or a full "yourteam.cloudflareaccess.com". */
function teamDomain(): string {
  const t = rawTeam()!;
  return t.includes('.') ? t : `${t}.cloudflareaccess.com`;
}

// Cache the remote JWKS per team domain so we don't rebuild/re-fetch it on every
// request; jose keeps the keys warm and refreshes them in the background.
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let cachedFor: string | null = null;
function getJwks() {
  const td = teamDomain();
  if (!cachedJwks || cachedFor !== td) {
    cachedJwks = createRemoteJWKSet(new URL(`https://${td}/cdn-cgi/access/certs`));
    cachedFor = td;
  }
  return cachedJwks;
}

/**
 * Verify a `Cf-Access-Jwt-Assertion` header value.
 * - Returns `true` (allow) when CF Access is not configured — inert.
 * - Returns `false` when configured but the token is missing, malformed,
 *   expired, or fails issuer/audience/signature checks.
 */
export async function verifyCfAccessToken(
  token: string | null | undefined,
): Promise<boolean> {
  if (!cfAccessEnabled()) return true; // inert until configured
  if (!token) return false;
  try {
    await jwtVerify(token, getJwks(), {
      issuer: `https://${teamDomain()}`,
      audience: audience(),
    });
    return true;
  } catch {
    return false;
  }
}

/** Test-only: drop the cached JWKS so a test can swap the mocked key set. */
export function __resetCfAccessJwksCacheForTests(): void {
  cachedJwks = null;
  cachedFor = null;
}
