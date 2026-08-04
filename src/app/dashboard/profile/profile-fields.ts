/**
 * Allowlist of columns on the `profiles` table that are user-editable via
 * server actions. Any key not in this list will be REJECTED by
 * updateProfileFields (and any future caller that writes user-supplied
 * field names) — this prevents remote property injection (CodeQL alert #2,
 * CWE-250 / CWE-400) where an attacker submits an unexpected column name.
 *
 * Sourced from supabase/migrations/20260324061701_create_lyra_schema.sql
 * + 20260330120000_add_avatar_url_and_storage.sql.
 *
 * EXPLICITLY EXCLUDED:
 * - id, user_id, created_at, updated_at: system-managed columns, must
 *   never be writable by user input.
 * - slug: unique-constrained at DB level, requires a separate flow with
 *   collision handling. NOT in this allowlist by design.
 *
 * Lives in this sibling module (rather than alongside the server actions
 * in `actions.ts`) because Next.js 16+ rejects non-async-function exports
 * from `'use server'` files at action-invocation time. See BUGS-12.
 */
export const ALLOWED_PROFILE_FIELDS = [
  'display_name',
  'headline',
  'bio_short',
  'city',
  'region',
  // KAN-339: `postcode_prefix` removed — postcode is no longer collected, stored,
  // or used for discovery (replaced by town/city discovery, KAN-341). The column
  // is retained nullable + scrubbed by the KAN-339 migration; it is no longer
  // user-editable, so it is intentionally absent from this allowlist.
  'country',
  'avatar_url',
  'is_published',
  'onboarding_complete',
  'completion_score',
  // KAN-443: the optional "I'd rather choose my own" line. Public text, so it
  // gets the same sanitise + moderation treatment as every other string field
  // in updateProfileFields. See giftVoucherHintPayload below before writing it.
  'gift_voucher_hint',
] as const;

export type AllowedProfileField = typeof ALLOWED_PROFILE_FIELDS[number];

export function isAllowedProfileField(key: string): key is AllowedProfileField {
  return (ALLOWED_PROFILE_FIELDS as readonly string[]).includes(key);
}

/** Longest voucher hint we store. One line, not an essay. */
export const GIFT_VOUCHER_HINT_MAX_LENGTH = 200;

/**
 * KAN-443 — build the `updateProfileFields` payload fragment for
 * `profiles.gift_voucher_hint`, deciding whether the key belongs in the write
 * at all.
 *
 * ⚠️ THIS IS A MIGRATION-ORDERING GUARD, NOT A STYLE PREFERENCE.
 * PostgREST derives the UPDATE column list from the payload KEYS, so sending
 * `gift_voucher_hint` to an environment where migration
 * 20260803170000_kan443_gift_redesign.sql has not run yet fails the WHOLE
 * request with PGRST204 — even when the value is null. Code reaches an
 * environment before its migration does. `profiles` is the busiest table in the
 * app, so an unconditional key here would break unrelated saves, not just this
 * feature.
 *
 * The rule is "include the key only when there is something to say about the
 * column":
 *
 *   - a non-empty hint            → write it
 *   - clearing a hint that EXISTS → write null (a real, intentional clear)
 *   - empty with nothing stored   → omit the key entirely
 *
 * The middle case is safe on an unmigrated environment for the same reason it
 * is meaningful: a member can only be clearing a stored hint if the column
 * existed to store it.
 *
 * Lives in this sibling module rather than in actions.ts because Next.js 16+
 * rejects non-async-function exports from a `'use server'` file (BUGS-12 /
 * gotcha #18).
 */
export function giftVoucherHintPayload(
  next: string,
  stored: string | null | undefined,
): { gift_voucher_hint?: string | null } {
  const trimmed = next.trim();
  if (trimmed !== '') return { gift_voucher_hint: trimmed };
  const hadStoredHint = typeof stored === 'string' && stored.trim() !== '';
  return hadStoredHint ? { gift_voucher_hint: null } : {};
}
