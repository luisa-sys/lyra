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
  'postcode_prefix',
  'country',
  'avatar_url',
  'is_published',
  'onboarding_complete',
  'completion_score',
] as const;

export type AllowedProfileField = typeof ALLOWED_PROFILE_FIELDS[number];

export function isAllowedProfileField(key: string): key is AllowedProfileField {
  return (ALLOWED_PROFILE_FIELDS as readonly string[]).includes(key);
}
