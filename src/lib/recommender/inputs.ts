/**
 * KAN-198: canonical types + helpers for the recommender-input fields on
 * `profiles`. See docs/RECOMMENDER_INPUTS.md for the full inventory.
 *
 * Used by:
 *   - The (future) V2 recommender that reads recipient_attributes.
 *   - The (future) MCP tool that accepts buyer-context parameters.
 *   - The (future) profile UI that lets a buyer edit these fields.
 *
 * Keep the enum literals here aligned with:
 *   - The SQL check constraint in
 *     supabase/migrations/20260516220000_recipient_recommender_fields.sql
 *   - The JSONB shape in docs/RECOMMENDER_INPUTS.md
 *
 * No `'use server'` — this module exports types + constants + pure
 * functions, callable from any context.
 */

// -----------------------------------------------------------------------------
// Age range buckets (column `profiles.age_range`)
// -----------------------------------------------------------------------------

export const AGE_RANGE_BUCKETS = [
  '0_5',
  '6_12',
  '13_17',
  '18_29',
  '30_44',
  '45_64',
  '65_plus',
] as const;

export type AgeRangeBucket = (typeof AGE_RANGE_BUCKETS)[number];

const AGE_RANGE_SET: ReadonlySet<string> = new Set(AGE_RANGE_BUCKETS);

export function isAgeRangeBucket(value: unknown): value is AgeRangeBucket {
  return typeof value === 'string' && AGE_RANGE_SET.has(value);
}

// -----------------------------------------------------------------------------
// Dietary restrictions (recipient_attributes.dietary[])
// -----------------------------------------------------------------------------

export const DIETARY_RESTRICTIONS = [
  'vegan',
  'vegetarian',
  'pescatarian',
  'gluten_free',
  'dairy_free',
  'nut_free',
  'shellfish_free',
  'halal',
  'kosher',
  'no_pork',
  'no_alcohol',
] as const;

export type DietaryRestriction = (typeof DIETARY_RESTRICTIONS)[number];

const DIETARY_SET: ReadonlySet<string> = new Set(DIETARY_RESTRICTIONS);

export function isDietaryRestriction(value: unknown): value is DietaryRestriction {
  return typeof value === 'string' && DIETARY_SET.has(value);
}

// -----------------------------------------------------------------------------
// Allergies (recipient_attributes.allergies[])
// -----------------------------------------------------------------------------

export const ALLERGIES = [
  'nuts',
  'peanuts',
  'shellfish',
  'fish',
  'eggs',
  'dairy',
  'gluten',
  'soy',
  'sesame',
  'wheat',
  'latex',
] as const;

export type Allergy = (typeof ALLERGIES)[number];

const ALLERGY_SET: ReadonlySet<string> = new Set(ALLERGIES);

export function isAllergy(value: unknown): value is Allergy {
  return typeof value === 'string' && ALLERGY_SET.has(value);
}

// -----------------------------------------------------------------------------
// recipient_attributes JSONB shape
// -----------------------------------------------------------------------------

export type RecipientAttributes = {
  dietary?: DietaryRestriction[];
  allergies?: Allergy[];
  sizes?: {
    clothing?: string;
    shoes_uk?: string;
    shoes_us?: string;
    shoes_eu?: string;
  };
  dislikes_text?: string;
};

/**
 * Coerce a raw JSONB blob (from the DB or an untyped API client) into the
 * typed RecipientAttributes shape. Unknown keys are dropped, enums are
 * validated and filtered to known values, sizes are coerced to short strings,
 * dislikes_text is length-capped.
 *
 * Returns an empty object on null / undefined / wrong shape.
 *
 * Used everywhere we read recipient_attributes — the SQL column is `jsonb`
 * so the DB driver hands us `unknown`, and we never trust the shape blind.
 */
export function coerceRecipientAttributes(
  raw: unknown
): RecipientAttributes {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== 'object') return {};
  if (Array.isArray(raw)) return {};

  const obj = raw as Record<string, unknown>;
  const out: RecipientAttributes = {};

  if (Array.isArray(obj.dietary)) {
    const filtered = obj.dietary.filter(isDietaryRestriction);
    if (filtered.length > 0) out.dietary = filtered;
  }

  if (Array.isArray(obj.allergies)) {
    const filtered = obj.allergies.filter(isAllergy);
    if (filtered.length > 0) out.allergies = filtered;
  }

  if (obj.sizes && typeof obj.sizes === 'object' && !Array.isArray(obj.sizes)) {
    const sizesIn = obj.sizes as Record<string, unknown>;
    const sizes: NonNullable<RecipientAttributes['sizes']> = {};
    // Each size value is coerced to a short trimmed string. Reject anything
    // longer than 20 chars — sizes are codes like "M", "L", "EU42", not prose.
    for (const key of ['clothing', 'shoes_uk', 'shoes_us', 'shoes_eu'] as const) {
      const v = sizesIn[key];
      if (typeof v === 'string') {
        const trimmed = v.trim();
        if (trimmed.length > 0 && trimmed.length <= 20) {
          sizes[key] = trimmed;
        }
      }
    }
    if (Object.keys(sizes).length > 0) out.sizes = sizes;
  }

  if (typeof obj.dislikes_text === 'string') {
    const trimmed = obj.dislikes_text.trim();
    if (trimmed.length > 0) {
      out.dislikes_text = trimmed.slice(0, 500);
    }
  }

  return out;
}

// -----------------------------------------------------------------------------
// Buyer-context per-request inputs (NOT stored on the profile)
// -----------------------------------------------------------------------------

export const OCCASIONS = [
  'birthday',
  'christmas',
  'anniversary',
  'valentines',
  'just_because',
  'other',
] as const;

export type Occasion = (typeof OCCASIONS)[number];

const OCCASION_SET: ReadonlySet<string> = new Set(OCCASIONS);

export function isOccasion(value: unknown): value is Occasion {
  return typeof value === 'string' && OCCASION_SET.has(value);
}

export const RELATIONSHIPS = [
  'partner',
  'parent',
  'child',
  'sibling',
  'friend',
  'colleague',
  'other',
] as const;

export type Relationship = (typeof RELATIONSHIPS)[number];

const RELATIONSHIP_SET: ReadonlySet<string> = new Set(RELATIONSHIPS);

export function isRelationship(value: unknown): value is Relationship {
  return typeof value === 'string' && RELATIONSHIP_SET.has(value);
}
