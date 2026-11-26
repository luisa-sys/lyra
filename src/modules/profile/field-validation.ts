/**
 * KAN-486 — per-field validation specs for member-written profile text:
 * fixed `profiles` fields, profile items (by v0.8 category rule from
 * ./profile-rules), section 05 prompts and affiliations.
 *
 * Item limits come from ITEM_RULES; legacy (pre-v0.8) categories with no rule
 * keep their previous ceilings (title 200, description 1000), now enforced by
 * rejection rather than truncation. KAN-490 migrates those categories.
 */

import { itemRuleFor, ITEM_RULES, PROFILE_FIELD_MAX, AFFILIATION_RULES } from './profile-rules';
import { validateFreeText, type FreeTextResult, type FreeTextSpec } from './free-text';
import type { ManualOfMeField } from './manual-of-me-fields';

/**
 * Validation spec for each string column `updateProfileFields` may write
 * (v0.8 §01, §03, §10). City/country are places, so only email/phone are
 * blocked there. `region` has no v0.8 limit; it keeps the previous 500.
 */
export const PROFILE_FIELD_SPECS: Readonly<Record<string, FreeTextSpec>> = {
  display_name: { label: 'Display name', max: PROFILE_FIELD_MAX.display_name },
  headline: { label: 'Headline', max: PROFILE_FIELD_MAX.headline },
  bio_short: { label: 'Short intro', max: PROFILE_FIELD_MAX.bio_short, multiline: true },
  billboard: { label: 'Billboard', max: PROFILE_FIELD_MAX.billboard, multiline: true },
  gift_voucher_hint: { label: 'Gift preferences', max: PROFILE_FIELD_MAX.gift_voucher_hint, multiline: true },
  city: { label: 'City', max: PROFILE_FIELD_MAX.city, contact: 'places' },
  region: { label: 'Region', max: 500, contact: 'places' },
  country: { label: 'Country', max: PROFILE_FIELD_MAX.country, contact: 'places' },
};

/** Validate one string value for a `profiles` column. Unknown keys get the old 500 single-line default. */
export function validateProfileField(key: string, raw: string): FreeTextResult {
  return validateFreeText(raw, PROFILE_FIELD_SPECS[key] ?? { label: key, max: 500 });
}

export const LEGACY_TITLE_MAX = 200;
export const LEGACY_DESCRIPTION_MAX = 1000;
export const GROUP_LABEL_MAX = 60;

/**
 * Item text uses the FULL contact filter in every category, favourite places
 * included: a place's name is enough, and v0.8 §05 forbids public postal
 * addresses. Stricter than an exception, and the add and edit paths agree.
 */

/** Member-facing field labels per category (quotes store the author in description). */
function labelsFor(category: string | null): { title: string; description: string } {
  if (category === 'quotes') return { title: 'Quote', description: 'Author / Speaker / Character' };
  return { title: 'Title', description: 'Description' };
}

/**
 * The highest limit any category allows. Used on the EDIT path, which does not
 * know the item's category without an extra read — and that read would put a
 * second `.eq('profile_id')` on profile_items next to the UPDATE's ownership
 * filter (the pooled-eq hazard). The exact per-category limit is enforced by
 * the step-2 trigger enforce_profile_item_rules(), whose message db-error-copy
 * maps to member copy.
 */
const ITEM_TITLE_CEILING = Math.max(LEGACY_TITLE_MAX, ...Object.values(ITEM_RULES).map((r) => r.titleMax));
const ITEM_DESCRIPTION_CEILING = Math.max(
  LEGACY_DESCRIPTION_MAX,
  ...Object.values(ITEM_RULES).map((r) => r.descriptionMax),
);

/**
 * KAN-487 line-break decision (founder, 2026-11-23): item DESCRIPTIONS (every
 * category) and the QUOTE text (a `quotes` title) are multiline — their line
 * breaks are kept. Every other item title is one line (whitespace collapsed).
 * The edit path's null-category ceiling cannot tell a quote apart, so it
 * keeps titles single-line.
 */
export function itemTitleIsMultiline(category: string | null): boolean {
  return category === 'quotes';
}

/** Title for a known category (add path), or `null` for the ceiling (edit path). */
export function validateItemTitle(category: string | null, raw: string | null | undefined): FreeTextResult {
  const rule = category === null ? null : itemRuleFor(category);
  const max = category === null ? ITEM_TITLE_CEILING : rule ? rule.titleMax : LEGACY_TITLE_MAX;
  return validateFreeText(raw, {
    label: labelsFor(category).title,
    max,
    required: true,
    multiline: itemTitleIsMultiline(category),
  });
}

/** Description for a known category (add path), or `null` for the ceiling (edit path). Multiline. */
export function validateItemDescription(category: string | null, raw: string | null | undefined): FreeTextResult {
  const rule = category === null ? null : itemRuleFor(category);
  const max = category === null ? ITEM_DESCRIPTION_CEILING : rule ? rule.descriptionMax : LEGACY_DESCRIPTION_MAX;
  return validateFreeText(raw, { label: labelsFor(category).description, max, multiline: true });
}

export function validateGroupLabel(raw: string | null | undefined): FreeTextResult {
  return validateFreeText(raw, { label: 'Group name', max: GROUP_LABEL_MAX });
}

// ── Section 05 "To understand me a little better" (v0.8 §05) ──────────

/** Member-facing name of each Manual-of-Me prompt, for error messages. */
export const MANUAL_OF_ME_LABELS = {
  good_to_know: 'Good to know about me',
  boundaries: 'My boundaries',
  communication_style: 'How I find communication easier',
  working_preferences: 'If you ever come to my house',
  energises_me: 'What gives me energy',
  drains_me: 'What drains me',
} as const satisfies Record<ManualOfMeField, string>;

// ── Affiliations (v0.8 §02) ─────────────────────────────────────────────

export function validateAffiliationName(raw: string | null | undefined): FreeTextResult {
  return validateFreeText(raw, { label: 'Name', max: AFFILIATION_RULES.nameMax, required: true });
}

/**
 * For a school `school_location` holds the required postcode (≤ 12) — a
 * postcode is the point of it, so the contact filter is off; its format is
 * checked by isSchoolPostcodeValid. For organisations/communities it is an
 * optional place (≤ 120), so only email/phone are blocked.
 */
export function validateAffiliationLocation(isSchool: boolean, raw: string | null | undefined): FreeTextResult {
  return isSchool
    ? validateFreeText(raw, { label: 'Postcode', max: AFFILIATION_RULES.schoolPostcodeMax, contact: 'off' })
    : validateFreeText(raw, { label: 'Location', max: AFFILIATION_RULES.locationMax, contact: 'places' });
}

export function validateAffiliationDescription(raw: string | null | undefined): FreeTextResult {
  return validateFreeText(raw, { label: 'Description', max: AFFILIATION_RULES.descriptionMax });
}
