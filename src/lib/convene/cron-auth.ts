/**
 * Constant-time comparison helper for Convene cron-route bearer auth (SEC-76,
 * finding web-convene-4).
 *
 * The Convene cron routes authenticate with `Authorization: Bearer ${CRON_SECRET}`.
 * Comparing the incoming header to the expected value with `!==` (or `===`)
 * short-circuits on the first differing byte, so the comparison time leaks how
 * many leading bytes matched — a classic timing side-channel against the secret.
 *
 * `timingSafeStrEqual` compares in constant time using `crypto.timingSafeEqual`.
 * It also avoids leaking the secret's length: on a length mismatch it still runs
 * a fixed compare before returning false, and it never throws on a null/short
 * input (unauthenticated callers simply get `false`).
 *
 * Mirrors the existing constant-time patterns in `src/lib/oauth/pkce.ts` and
 * `src/lib/age/didit.ts`.
 */
import { timingSafeEqual } from 'crypto';

export function timingSafeStrEqual(actual: string | null | undefined, expected: string): boolean {
  if (typeof actual !== 'string') return false;
  const a = Buffer.from(actual, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) {
    // Run a compare against a same-length buffer so the timing does not reveal
    // whether the length matched, then reject.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}
