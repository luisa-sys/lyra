/**
 * KAN-220: helpers for the `affiliation_type` column added to
 * `school_affiliations` by migration 20260517010000_affiliation_type.sql.
 *
 * Lives in this sibling module (NOT `actions.ts`) because Next.js 16+
 * rejects non-async-function exports from `'use server'` files at
 * action-invocation time — see BUGS-12. Constants, types, and synchronous
 * coercion helpers must live outside the action file.
 *
 * The allowlist mirrors the DB-side CHECK constraint:
 *   check (affiliation_type in ('school', 'organisation', 'community'))
 *
 * Anything not in this list is coerced to 'school' on write rather than
 * reaching the DB and triggering a constraint violation.
 */

export const ALLOWED_AFFILIATION_TYPES = ['school', 'organisation', 'community'] as const;

export type AffiliationType = typeof ALLOWED_AFFILIATION_TYPES[number];

export function isAffiliationType(v: string): v is AffiliationType {
  return (ALLOWED_AFFILIATION_TYPES as readonly string[]).includes(v);
}

export function coerceAffiliationType(v: string | undefined): AffiliationType {
  if (v && isAffiliationType(v)) {
    return v;
  }
  return 'school';
}

// Human-readable labels for each type. Used as section headings in the
// affiliations editor and to label items on the public profile.
export const AFFILIATION_LABELS: Record<AffiliationType, string> = {
  school: 'Schools',
  organisation: 'Organisations',
  community: 'Communities',
};

// Singular forms for "+ Add a …" buttons and per-row placeholders.
export const AFFILIATION_SINGULAR: Record<AffiliationType, string> = {
  school: 'school',
  organisation: 'organisation',
  community: 'community',
};
