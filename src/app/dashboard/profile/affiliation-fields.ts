/**
 * KAN-220: helpers for the `affiliation_type` column added to
 * `school_affiliations` by migration 20260517010000_affiliation_type.sql.
 *
 * Lives in this sibling module (NOT `actions.ts`) because Next.js 16+
 * rejects non-async-function exports from `'use server'` files at
 * action-invocation time — see BUGS-12. Constants, types, and synchronous
 * coercion helpers must live outside the action file.
 *
 * KAN-487: the pure rules now live in src/modules/profile/affiliation-rules.ts
 * (so modules can use them without importing from src/app). This file keeps
 * every export name it had: the rules are re-exported from there, and the
 * labels below stay here.
 */

import {
  ALLOWED_AFFILIATION_TYPES as RULES_ALLOWED_AFFILIATION_TYPES,
  coerceAffiliationType as rulesCoerceAffiliationType,
  isAffiliationType as rulesIsAffiliationType,
  type AffiliationType,
} from '@/modules/profile/affiliation-rules';

export type { AffiliationType } from '@/modules/profile/affiliation-rules';
export { requiresPostcode, isSchoolPostcodeValid } from '@/modules/profile/affiliation-rules';

// Thin delegations (rather than a bare `export { … } from`) keep the
// declarations visible here for the KAN-220 export-surface guard in
// tests/unit/affiliations-and-autosave.test.ts.
export const ALLOWED_AFFILIATION_TYPES = RULES_ALLOWED_AFFILIATION_TYPES;

export function isAffiliationType(v: string): v is AffiliationType {
  return rulesIsAffiliationType(v);
}

export function coerceAffiliationType(v: string | undefined): AffiliationType {
  return rulesCoerceAffiliationType(v);
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
