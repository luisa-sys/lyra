/**
 * Simple in-memory rate limiter for Next.js middleware (Edge Runtime compatible).
 *
 * ⚠️ Limitation: In-memory store resets on cold starts and is per-instance.
 * On Vercel's serverless/edge, each instance has its own store, so the
 * effective cap is (per-key cap × live instance count). This provides basic
 * per-instance protection against brute-force attacks but is NOT a distributed
 * rate limiter.
 *
 * SEC-62: for the OAuth endpoints (/oauth/token, /oauth/revoke, /oauth/register)
 * the cap must hold across instances, so those routes go through
 * `sharedRateLimit()` in `rate-limit-shared.ts` (Supabase-backed, atomic). That
 * helper falls back to THIS in-memory limiter when the shared store is
 * unreachable, so this module is still the durable-degradation backstop — never
 * remove it. Middleware (Edge) keeps using `rateLimit()` directly.
 *
 * KAN-61: Rate limiting on auth endpoints
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 60 seconds
const CLEANUP_INTERVAL = 60_000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }
}

export interface RateLimitConfig {
  /** Max requests allowed in the window */
  limit: number;
  /** Window duration in seconds */
  windowSeconds: number;
}

/**
 * Check if a request should be rate limited.
 * Returns { limited: false } if allowed, { limited: true, retryAfter } if blocked.
 */
export function rateLimit(
  key: string,
  config: RateLimitConfig
): { limited: boolean; retryAfter?: number } {
  cleanup();

  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { limited: false };
  }

  entry.count++;

  if (entry.count > config.limit) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { limited: true, retryAfter };
  }

  return { limited: false };
}

/** Rate limit presets */
export const RATE_LIMITS = {
  /** Auth endpoints: 10 attempts per 15 minutes */
  auth: { limit: 10, windowSeconds: 900 },
  /** Profile updates: 30 per minute */
  profileWrite: { limit: 30, windowSeconds: 60 },
  /** General API: 60 per minute */
  api: { limit: 60, windowSeconds: 60 },
  /** OAuth Dynamic Client Registration: 5 new clients/hour per IP (SEC-19/F-05) */
  oauthRegister: { limit: 5, windowSeconds: 3600 },
  /** OAuth token endpoint, per source IP (SEC-62/web-oauth-4) — anti-DoS. */
  oauthTokenIp: { limit: 60, windowSeconds: 60 },
  /** OAuth token endpoint, per client_id (SEC-62) — allows legit refresh churn. */
  oauthTokenClient: { limit: 120, windowSeconds: 60 },
  /** OAuth revoke endpoint, per source IP (SEC-62/web-oauth-4). */
  oauthRevokeIp: { limit: 60, windowSeconds: 60 },
  /** OAuth revoke endpoint, per client_id (SEC-62). */
  oauthRevokeClient: { limit: 120, windowSeconds: 60 },
} as const;
