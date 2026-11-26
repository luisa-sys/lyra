/**
 * KAN-487 — pure affiliation rules (spec v0.8 §03 "Schools, organisations and
 * communities"), moved out of src/app/dashboard/profile/affiliation-fields.ts
 * so that modules (the v0.8 editor's payload validation and save_profile
 * server code) can use them — modules may not import from src/app/**.
 *
 * affiliation-fields.ts re-exports everything here under the same names, so
 * existing imports keep working. Labels and copy stay in affiliation-fields.ts.
 *
 * Originally KAN-220 (affiliation_type) and KAN-404 (school postcode). The
 * allowlist mirrors the DB-side CHECK constraint:
 *   check (affiliation_type in ('school', 'organisation', 'community'))
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

/**
 * KAN-404: schools MUST carry a postcode (full or partial) so people can
 * tell schools with the same name apart. Organisations and communities
 * keep location optional. This helper says which affiliation types require
 * a postcode.
 */
export function requiresPostcode(type: string): boolean {
  return type === 'school';
}

/**
 * KAN-404: permissive / international postcode validator. We are NOT
 * validating against any single country's format — Lyra has an international
 * user base — so we only require enough structure to be a plausible
 * postcode: a short-ish token that contains at least one letter AND at least
 * one digit.
 *
 * Accepts: 'SW1A', 'M1', 'SW1A 1AA', 'B33 8TH' (UK full/partial),
 * and other alphanumeric international codes.
 * Rejects: '' (empty), 'London' (letters only, no digit),
 * '12345' (digits only — no way to disambiguate a US-style all-numeric ZIP
 * from a house number here; the letter+digit rule is the disambiguating
 * signal we chose for this permissive check).
 */
export function isSchoolPostcodeValid(v: string | undefined | null): boolean {
  const s = (v || '').trim();
  return s.length >= 2 && s.length <= 12 && /[a-z]/i.test(s) && /\d/.test(s);
}
