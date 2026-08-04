/**
 * Shared, cross-instance rate limiter — SEC-62 (web-oauth-4).
 *
 * The in-memory `rateLimit()` in `./rate-limit` is per-serverless-instance, so
 * on Vercel the effective cap is (per-key cap × live instance count). For the
 * OAuth endpoints that is not good enough: an attacker spraying /oauth/token or
 * /oauth/register lands across many lambdas and each sees only a fraction of the
 * traffic. This helper backs the counter with a single Supabase row via the
 * atomic `rate_limit_hit` RPC (migration 20260708033000), so the cap holds no
 * matter how many instances serve the requests.
 *
 * Failure posture — FAIL OPEN to the in-memory limiter, never fail closed:
 * if the shared store is unreachable (missing service-role env, network error,
 * RPC error) we fall back to the per-instance `rateLimit()`. That keeps some
 * protection (per-instance cap) without ever DoS-ing legitimate callers when the
 * DB blips, and it makes the helper deterministic under unit tests (which have
 * no Supabase env, so they exercise the in-memory path). `degraded: true` flags
 * the fallback for callers that want to log it.
 */

import { createServiceRoleClient } from '@/lib/supabase-service';
import { rateLimit, type RateLimitConfig } from '@/lib/rate-limit';

export interface SharedRateLimitResult {
  /** True when this request is over the cap and should be refused (429). */
  limited: boolean;
  /** Seconds until the window resets (for the Retry-After header). */
  retryAfter?: number;
  /** True when the shared store was unreachable and we fell back in-memory. */
  degraded: boolean;
}

interface RateLimitHitRow {
  limited: boolean;
  retry_after: number;
}

/**
 * Increment the counter for `key` and report whether the caller is over `config`.
 * Uses the shared Supabase store; falls back to the in-memory limiter on any
 * error so it never fails closed.
 */
export async function sharedRateLimit(
  key: string,
  config: RateLimitConfig
): Promise<SharedRateLimitResult> {
  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase.rpc('rate_limit_hit', {
      p_bucket: key,
      p_limit: config.limit,
      p_window_seconds: config.windowSeconds,
    });
    if (error) throw error;

    // `RETURNS TABLE (...)` comes back as an array of rows.
    const row = (Array.isArray(data) ? data[0] : data) as RateLimitHitRow | undefined;
    if (!row || typeof row.limited !== 'boolean') {
      throw new Error('rate_limit_hit returned no usable row');
    }
    return {
      limited: row.limited,
      retryAfter: typeof row.retry_after === 'number' ? row.retry_after : undefined,
      degraded: false,
    };
  } catch {
    // Shared store unavailable → per-instance best-effort backstop.
    const local = rateLimit(key, config);
    return { limited: local.limited, retryAfter: local.retryAfter, degraded: true };
  }
}

import { clientIp } from '@/lib/client-ip';

/**
 * Extract the best-effort client IP from proxy headers (Cloudflare → Vercel).
 * Shared by the OAuth route handlers so they bucket consistently.
 */
export function clientIpFromHeaders(headers: Headers): string {
  // SEC-120: delegates to the single shared implementation. Kept as a named
  // export so the OAuth routes' import sites do not churn.
  return clientIp(headers);
}
