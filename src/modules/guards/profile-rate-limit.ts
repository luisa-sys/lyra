/**
 * KAN-231 (KAN-63 Tier 2-D) — profile-save rate limiting.
 *
 * Thin wrapper around the existing in-memory `rateLimit` helper that:
 *   1. Limits per-user (primary key: `profile-write:user:<userId>`)
 *   2. Limits per-IP (secondary key: `profile-write:ip:<addr>`)
 *
 * Both keys must pass. The IP guard catches single-IP-many-account abuse
 * patterns; the user guard catches single-account hammering. They are
 * independent — exceeding either returns the same action-shaped error,
 * with the `reason` field telling the caller which one triggered.
 *
 * Returns a ready-to-return `ActionResult` so server actions can do:
 *
 *     const rl = await checkProfileWriteRateLimit(user.id);
 *     if (!rl.allowed) return rl.result;
 *
 * **Failure mode = default allow.** If `headers()` throws (no request
 * context — e.g. unit test or static render), we skip the IP guard.
 * Rate-limit storage is in-memory and process-local; on cold start the
 * counters reset, which is acceptable per the existing `rate-limit.ts`
 * warning. For distributed enforcement we'd need Upstash Redis.
 */

import { headers } from 'next/headers';
import { rateLimit, RATE_LIMITS } from './rate-limit';
import type { ActionResult } from './sanitise';

export type ProfileRateLimitOutcome =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'user' | 'ip';
      retryAfter: number;
      result: ActionResult;
    };

function friendlyError(retryAfter: number, reason: 'user' | 'ip'): string {
  const waitMsg = retryAfter > 0 ? ` Please wait ${retryAfter}s and try again.` : '';
  return reason === 'ip'
    ? `Too many requests from your network.${waitMsg}`
    : `You are saving too quickly.${waitMsg}`;
}

async function readClientIp(): Promise<string | null> {
  try {
    const h = await headers();
    const fwd = h.get('x-forwarded-for');
    if (fwd) {
      const first = fwd.split(',')[0]?.trim();
      if (first) return first;
    }
    const real = h.get('x-real-ip');
    if (real) return real.trim();
  } catch {
    // headers() throws outside a request context (unit tests, build-time
    // static analysis). Degrade gracefully — user-key path still applies.
  }
  return null;
}

export async function checkProfileWriteRateLimit(
  userId: string,
): Promise<ProfileRateLimitOutcome> {
  const userKey = `profile-write:user:${userId}`;
  const userRl = rateLimit(userKey, RATE_LIMITS.profileWrite);
  if (userRl.limited) {
    const retry = userRl.retryAfter ?? RATE_LIMITS.profileWrite.windowSeconds;
    return {
      allowed: false,
      reason: 'user',
      retryAfter: retry,
      result: { success: false, error: friendlyError(retry, 'user') },
    };
  }

  const ip = await readClientIp();
  if (ip) {
    const ipKey = `profile-write:ip:${ip}`;
    const ipRl = rateLimit(ipKey, RATE_LIMITS.profileWrite);
    if (ipRl.limited) {
      const retry = ipRl.retryAfter ?? RATE_LIMITS.profileWrite.windowSeconds;
      return {
        allowed: false,
        reason: 'ip',
        retryAfter: retry,
        result: { success: false, error: friendlyError(retry, 'ip') },
      };
    }
  }

  return { allowed: true };
}
