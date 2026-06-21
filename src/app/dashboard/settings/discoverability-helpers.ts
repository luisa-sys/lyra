/**
 * KAN-153: pure helpers for phone/postcode discoverability.
 *
 * Lives in a sibling .ts module (rather than inside `discoverability-actions.ts`)
 * because Next.js 16+ rejects non-async-function exports from `'use server'`
 * files at action-invocation time. See BUGS-12 and
 * scripts/check-server-action-exports.sh.
 *
 * Privacy-first notes:
 *   - Functions in this module NEVER log the plain phone/postcode they
 *     receive. Errors are returned as opaque ActionResult shapes upstream;
 *     this file deliberately avoids `console.log` / `throw new Error(input)`
 *     on raw inputs.
 *   - The pepper is read from `process.env.LYRA_SEARCH_PEPPER` at hash time.
 *     Missing pepper is a hard failure — we do NOT silently fall back to an
 *     empty pepper (that would let an attacker who knows the algorithm
 *     mount a rainbow-table attack against any unpeppered hashes that
 *     accidentally got persisted).
 */
import { createHmac } from 'crypto';

/** What kind of contact value is being hashed. */
export type ContactKind = 'phone' | 'postcode';

/** Per-user rate-limit for lookup attempts (defence against enumeration). */
export const SEARCH_RATE_LIMIT = {
  limit: 10,
  windowSeconds: 3600, // 1 hour
} as const;

/**
 * Read the search pepper from env. Throws if missing — by design.
 * We do not include the pepper in the error message.
 */
export function getSearchPepper(): string {
  const pepper = process.env.LYRA_SEARCH_PEPPER;
  if (!pepper || pepper.length < 16) {
    throw new Error(
      'LYRA_SEARCH_PEPPER is not configured. See docs/SECURITY_ROTATION.md.'
    );
  }
  return pepper;
}

/**
 * SEC-18 (F-04 part 2): the HMAC key for contact-discovery hashes. Prefers the
 * dedicated `CONTACT_SEARCH_HMAC_KEY`; falls back to `LYRA_SEARCH_PEPPER` so the
 * SHA-256 → HMAC switch is non-breaking before the dedicated key is provisioned
 * on a given environment. Never included in error messages.
 */
export function getContactSearchHmacKey(): string {
  const key = process.env.CONTACT_SEARCH_HMAC_KEY;
  if (key && key.length >= 16) return key;
  // getSearchPepper() still hard-fails if NEITHER secret is configured.
  return getSearchPepper();
}

/**
 * Normalise a UK phone number to E.164 (best-effort).
 *
 * Rules (deliberately conservative):
 *   - Strip whitespace, hyphens, parentheses, dots.
 *   - Leading "00" → "+".
 *   - Leading "0" with no "+" → "+44" (UK default; documented in copy).
 *   - "+<digits>" passes through.
 *   - Reject if the result is fewer than 8 digits or more than 15.
 *
 * Returns null when the input cannot be normalised — callers MUST treat
 * null as "do not store, do not search" and surface a generic error.
 */
export function normalisePhone(input: string): string | null {
  if (typeof input !== 'string') return null;
  // Strip all whitespace, dashes, dots, parens. Keep digits and a leading '+'.
  const cleaned = input.replace(/[\s\-().]/g, '');
  if (cleaned.length === 0) return null;

  let normalised: string;
  if (cleaned.startsWith('+')) {
    normalised = cleaned;
  } else if (cleaned.startsWith('00')) {
    normalised = '+' + cleaned.slice(2);
  } else if (cleaned.startsWith('0')) {
    // UK default. The toggle copy in the UI documents this assumption.
    normalised = '+44' + cleaned.slice(1);
  } else if (/^\d+$/.test(cleaned)) {
    // Bare digits with no country code — refuse rather than guess.
    return null;
  } else {
    return null;
  }

  // After normalisation, must be '+' followed by 8-15 digits (ITU-T E.164).
  if (!/^\+\d{8,15}$/.test(normalised)) return null;
  return normalised;
}

/**
 * Normalise a UK postcode to the canonical "AA9 9AA" (or shorter) form,
 * but for hashing we collapse to a no-space uppercase representation so
 * "SW1A 1AA" and "sw1a1aa" hash identically.
 *
 * Returns null when the input is empty or obviously non-postcode-shaped.
 * We do NOT enforce the full UK postcode regex here — the search hash
 * matches whatever the user opts in with, and over-tight validation
 * would surprise users with edge-case but real postcodes (e.g. crown
 * dependencies, BFPO).
 */
export function normalisePostcode(input: string): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  // Uppercase, remove all whitespace.
  const collapsed = trimmed.toUpperCase().replace(/\s+/g, '');
  // Conservative shape check: alphanumerics only, length 5-8 (UK postcodes
  // are 5-7 chars without space; allow 8 to be forgiving).
  if (!/^[A-Z0-9]{5,8}$/.test(collapsed)) return null;
  return collapsed;
}

/**
 * Deterministic HMAC-SHA-256 hash, hex digest (SEC-18, F-04 part 2).
 *
 * Format: HMAC-SHA-256(key, kind || ':' || value)
 *   - HMAC-keying (rather than the old SHA-256(pepper || …) construction)
 *     means a stored hash can't be brute-forced with a precomputed rainbow
 *     table even if the algorithm and value space are known — an authenticated
 *     attacker can no longer enumerate members by guessing.
 *   - Including the `kind` inside the message keeps a phone hash from ever
 *     colliding with a postcode hash.
 *   - `key` is the server secret from getContactSearchHmacKey().
 *
 * This function does not validate the input — callers must normalise
 * first and refuse to call this with a null/empty value.
 */
export function hashContact(kind: ContactKind, value: string, key: string): string {
  if (!value) {
    throw new Error('hashContact called with empty value (programmer error)');
  }
  return createHmac('sha256', key)
    .update(kind)
    .update(':')
    .update(value)
    .digest('hex');
}

/**
 * Convenience: normalise + hash in one call, returning null on bad input.
 * Reads pepper from env. Callers should use this rather than chaining
 * normalise + hash manually so the no-pepper / bad-input failure modes
 * stay centralised.
 */
export function hashPhoneInput(input: string): string | null {
  const normalised = normalisePhone(input);
  if (!normalised) return null;
  return hashContact('phone', normalised, getContactSearchHmacKey());
}

export function hashPostcodeInput(input: string): string | null {
  const normalised = normalisePostcode(input);
  if (!normalised) return null;
  return hashContact('postcode', normalised, getContactSearchHmacKey());
}

/**
 * Generic shape for the rate-limit store. Injected so tests can swap in a
 * deterministic fake; production uses the in-memory store from
 * src/lib/rate-limit.ts.
 */
export interface RateLimitGate {
  (key: string, config: { limit: number; windowSeconds: number }):
    | { limited: false }
    | { limited: true; retryAfter: number };
}
