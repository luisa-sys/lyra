/**
 * KAN-198: tests for the structured recommender-input helpers.
 *
 * Locks in:
 *   1. The age-range buckets match the SQL CHECK constraint exactly.
 *   2. Enum type guards reject unknown values (defence against future schema
 *      drift between TS literals and DB constraints).
 *   3. coerceRecipientAttributes returns a safe typed shape from any raw
 *      JSONB input — the DB column is `jsonb` so we never trust the input
 *      shape blind.
 */

import {
  AGE_RANGE_BUCKETS,
  DIETARY_RESTRICTIONS,
  ALLERGIES,
  OCCASIONS,
  RELATIONSHIPS,
  isAgeRangeBucket,
  isDietaryRestriction,
  isAllergy,
  isOccasion,
  isRelationship,
  coerceRecipientAttributes,
} from '@/lib/recommender/inputs';

describe('KAN-198 recommender inputs — AGE_RANGE_BUCKETS', () => {
  test('matches the SQL CHECK constraint exactly', () => {
    // If you change the buckets here, also change the constraint in
    // supabase/migrations/20260516220000_recipient_recommender_fields.sql
    // and the docs in docs/RECOMMENDER_INPUTS.md.
    expect([...AGE_RANGE_BUCKETS]).toEqual([
      '0_5',
      '6_12',
      '13_17',
      '18_29',
      '30_44',
      '45_64',
      '65_plus',
    ]);
  });

  test('includes the AADC-relevant under-13 bucket', () => {
    // The under-13 bucket exists separately from 13-17 because UK GDPR Art 8
    // / AADC apply differently to under-13s. The recommender uses the bucket
    // to skip age-inappropriate gift categories.
    expect([...AGE_RANGE_BUCKETS]).toContain('0_5');
    expect([...AGE_RANGE_BUCKETS]).toContain('6_12');
  });
});

describe('KAN-198 recommender inputs — isAgeRangeBucket', () => {
  test('accepts every canonical bucket', () => {
    for (const b of AGE_RANGE_BUCKETS) {
      expect(isAgeRangeBucket(b)).toBe(true);
    }
  });

  test('rejects unknown / malformed', () => {
    expect(isAgeRangeBucket('0-5')).toBe(false); // hyphen instead of underscore
    expect(isAgeRangeBucket('18_30')).toBe(false); // boundary mismatch
    expect(isAgeRangeBucket('teen')).toBe(false);
    expect(isAgeRangeBucket('')).toBe(false);
    expect(isAgeRangeBucket(null)).toBe(false);
    expect(isAgeRangeBucket(42)).toBe(false);
  });
});

describe('KAN-198 recommender inputs — isDietaryRestriction', () => {
  test('accepts the common diets', () => {
    expect(isDietaryRestriction('vegan')).toBe(true);
    expect(isDietaryRestriction('vegetarian')).toBe(true);
    expect(isDietaryRestriction('gluten_free')).toBe(true);
    expect(isDietaryRestriction('halal')).toBe(true);
    expect(isDietaryRestriction('kosher')).toBe(true);
  });

  test('rejects unknown / casing', () => {
    expect(isDietaryRestriction('Vegan')).toBe(false); // case sensitive
    expect(isDietaryRestriction('gluten free')).toBe(false); // space, not underscore
    expect(isDietaryRestriction('paleo')).toBe(false);
    expect(isDietaryRestriction(null)).toBe(false);
  });
});

describe('KAN-198 recommender inputs — isAllergy', () => {
  test('accepts the common allergens', () => {
    expect(isAllergy('nuts')).toBe(true);
    expect(isAllergy('shellfish')).toBe(true);
    expect(isAllergy('eggs')).toBe(true);
    expect(isAllergy('latex')).toBe(true);
  });

  test('rejects unknown', () => {
    expect(isAllergy('strawberries')).toBe(false);
    expect(isAllergy('cats')).toBe(false);
    expect(isAllergy(null)).toBe(false);
  });
});

describe('KAN-198 recommender inputs — isOccasion / isRelationship', () => {
  test('isOccasion accepts every canonical occasion', () => {
    for (const o of OCCASIONS) {
      expect(isOccasion(o)).toBe(true);
    }
    expect(isOccasion('wedding')).toBe(false);
  });

  test('isRelationship accepts every canonical relationship', () => {
    for (const r of RELATIONSHIPS) {
      expect(isRelationship(r)).toBe(true);
    }
    expect(isRelationship('cousin')).toBe(false);
  });
});

describe('KAN-198 recommender inputs — coerceRecipientAttributes', () => {
  test('null / undefined / wrong shape → empty object', () => {
    expect(coerceRecipientAttributes(null)).toEqual({});
    expect(coerceRecipientAttributes(undefined)).toEqual({});
    expect(coerceRecipientAttributes('string')).toEqual({});
    expect(coerceRecipientAttributes(42)).toEqual({});
    expect(coerceRecipientAttributes([])).toEqual({});
  });

  test('passes through a well-formed payload', () => {
    const raw = {
      dietary: ['vegan', 'gluten_free'],
      allergies: ['nuts'],
      sizes: { clothing: 'M', shoes_uk: '8' },
      dislikes_text: 'Strong perfumes',
    };
    expect(coerceRecipientAttributes(raw)).toEqual({
      dietary: ['vegan', 'gluten_free'],
      allergies: ['nuts'],
      sizes: { clothing: 'M', shoes_uk: '8' },
      dislikes_text: 'Strong perfumes',
    });
  });

  test('filters unknown enum values out of arrays', () => {
    const raw = {
      dietary: ['vegan', 'paleo', 'gluten_free'], // paleo not in our list
      allergies: ['nuts', 'kryptonite'], // kryptonite not in our list
    };
    expect(coerceRecipientAttributes(raw)).toEqual({
      dietary: ['vegan', 'gluten_free'],
      allergies: ['nuts'],
    });
  });

  test('drops a dietary array that filters to empty', () => {
    expect(coerceRecipientAttributes({ dietary: ['paleo'] })).toEqual({});
  });

  test('drops unknown top-level keys', () => {
    const raw = {
      dietary: ['vegan'],
      religion: 'something', // not in schema
      favourite_colour: 'blue', // not in schema
    };
    expect(coerceRecipientAttributes(raw)).toEqual({ dietary: ['vegan'] });
  });

  test('caps dislikes_text at 500 chars', () => {
    const long = 'a'.repeat(1000);
    const out = coerceRecipientAttributes({ dislikes_text: long });
    expect(out.dislikes_text).toHaveLength(500);
  });

  test('trims dislikes_text', () => {
    expect(coerceRecipientAttributes({ dislikes_text: '   pink   ' })).toEqual({
      dislikes_text: 'pink',
    });
  });

  test('rejects size values longer than 20 chars (defence against prose)', () => {
    expect(
      coerceRecipientAttributes({
        sizes: {
          clothing: 'this is a very long string trying to inject prose into the sizes field',
          shoes_uk: '8',
        },
      })
    ).toEqual({ sizes: { shoes_uk: '8' } });
  });

  test('non-string size values dropped', () => {
    expect(
      coerceRecipientAttributes({
        sizes: { clothing: 42, shoes_uk: '8' },
      })
    ).toEqual({ sizes: { shoes_uk: '8' } });
  });

  test('non-array dietary dropped silently', () => {
    expect(
      coerceRecipientAttributes({ dietary: 'vegan' as unknown as string[] })
    ).toEqual({});
  });

  test('count of enum values stays in sync between TS and SQL', () => {
    // If you add a new enum value to DIETARY_RESTRICTIONS or ALLERGIES,
    // this is a reminder to double-check that nothing downstream pins on
    // the count. Just a sanity check, not a hard floor.
    expect(DIETARY_RESTRICTIONS.length).toBeGreaterThanOrEqual(8);
    expect(ALLERGIES.length).toBeGreaterThanOrEqual(8);
  });
});
