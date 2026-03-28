/**
 * Simple in-memory rate limiter for Next.js middleware (Edge Runtime compatible).
 *
 * ⚠️ Limitation: In-memory store resets on cold starts and is per-instance.
 * On Vercel's serverless/edge, each instance has its own store.
 * This provides basic protection against brute-force attacks but is NOT
 * a distributed rate limiter. For production scale, consider Upstash Redis.
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

interface RateLimitConfig {
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
} as const;
