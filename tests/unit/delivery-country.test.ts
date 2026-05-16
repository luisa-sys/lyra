/**
 * KAN-186: unit tests for the delivery-country helpers.
 *
 * These pure functions back the `delivery_country_code` column on the
 * `profiles` table — they're the last line of defence between user input
 * (UI <select>, MCP tool, future API) and the DB check constraint
 * (`^[A-Z]{2}$` + the supported-country allowlist).
 *
 * If these tests break, the recommender's eligibility filter (KAN-190) may
 * surface ineligible recommendations.
 */

import {
  SUPPORTED_DELIVERY_COUNTRIES,
  normaliseDeliveryCountry,
  isIsoAlpha2,
  type SupportedDeliveryCountry,
} from '@/lib/affiliate/country-codes';

describe('KAN-186 delivery country — SUPPORTED_DELIVERY_COUNTRIES', () => {
  test('includes GB as the primary market', () => {
    const codes = SUPPORTED_DELIVERY_COUNTRIES.map((c) => c.code);
    expect(codes).toContain('GB');
    expect(codes[0]).toBe('GB'); // first by rollout priority
  });

  test('covers the Earn Globally umbrella (UK + DE + FR + IT + ES)', () => {
    // Amazon UK Associates auto-extends to DE/FR/IT/ES via Earn Globally,
    // so all five need to be present together for Phase 2 to work.
    const codes: string[] = SUPPORTED_DELIVERY_COUNTRIES.map((c) => c.code);
    for (const c of ['GB', 'DE', 'FR', 'IT', 'ES']) {
      expect(codes).toContain(c);
    }
  });

  test('every entry has a 2-letter uppercase code + a non-empty name', () => {
    for (const entry of SUPPORTED_DELIVERY_COUNTRIES) {
      expect(entry.code).toMatch(/^[A-Z]{2}$/);
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });

  test('no duplicate codes', () => {
    const codes = SUPPORTED_DELIVERY_COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('KAN-186 delivery country — normaliseDeliveryCountry', () => {
  test('round-trips supported codes', () => {
    expect(normaliseDeliveryCountry('GB')).toBe('GB');
    expect(normaliseDeliveryCountry('US')).toBe('US');
    expect(normaliseDeliveryCountry('DE')).toBe('DE');
  });

  test('uppercases lowercase input', () => {
    expect(normaliseDeliveryCountry('gb')).toBe('GB');
    expect(normaliseDeliveryCountry('us')).toBe('US');
    expect(normaliseDeliveryCountry('De')).toBe('DE');
  });

  test('trims surrounding whitespace', () => {
    expect(normaliseDeliveryCountry('  GB  ')).toBe('GB');
    expect(normaliseDeliveryCountry('\tUS\n')).toBe('US');
  });

  test('returns null for empty / whitespace / null / undefined', () => {
    expect(normaliseDeliveryCountry('')).toBeNull();
    expect(normaliseDeliveryCountry('   ')).toBeNull();
    expect(normaliseDeliveryCountry(null)).toBeNull();
    expect(normaliseDeliveryCountry(undefined)).toBeNull();
  });

  test('returns null for codes not in the supported list', () => {
    // Brazil is a valid ISO-2 but not in our supported list (yet).
    expect(normaliseDeliveryCountry('BR')).toBeNull();
    // Three-letter code (ISO-3) — never accepted.
    expect(normaliseDeliveryCountry('USA')).toBeNull();
    // Full name — never accepted.
    expect(normaliseDeliveryCountry('United Kingdom')).toBeNull();
    // Random string.
    expect(normaliseDeliveryCountry('XX')).toBeNull();
  });

  test('rejects non-string runtime input safely', () => {
    // @ts-expect-error — testing runtime guard
    expect(normaliseDeliveryCountry(42)).toBeNull();
    // @ts-expect-error — testing runtime guard
    expect(normaliseDeliveryCountry({})).toBeNull();
  });

  test('handles the union with the type for callers that need it', () => {
    const result = normaliseDeliveryCountry('GB');
    if (result !== null) {
      // Compile-time check: the result widens to string, callers that need
      // SupportedDeliveryCountry must verify via membership.
      const code: string = result;
      expect(code).toBe('GB');
    }
  });
});

describe('KAN-186 delivery country — isIsoAlpha2', () => {
  // Wider than the supported list — used for narrowing against the DB check
  // constraint shape, not against our merchant coverage.

  test('accepts any uppercase 2-letter string', () => {
    expect(isIsoAlpha2('GB')).toBe(true);
    expect(isIsoAlpha2('US')).toBe(true);
    expect(isIsoAlpha2('XX')).toBe(true); // matches the DB constraint, even if not in our allowlist
  });

  test('rejects lowercase, 3-letter, full names, non-string', () => {
    expect(isIsoAlpha2('gb')).toBe(false);
    expect(isIsoAlpha2('USA')).toBe(false);
    expect(isIsoAlpha2('United Kingdom')).toBe(false);
    expect(isIsoAlpha2(null)).toBe(false);
    expect(isIsoAlpha2(undefined)).toBe(false);
    expect(isIsoAlpha2(42)).toBe(false);
    expect(isIsoAlpha2('G1')).toBe(false);
  });
});

describe('KAN-186 delivery country — type contract', () => {
  test('SupportedDeliveryCountry derives from the as-const tuple', () => {
    // Compile-time check that the type narrows correctly. If you add a new
    // country to SUPPORTED_DELIVERY_COUNTRIES, this still compiles because
    // the type is derived; if you accidentally widen the literal type, this
    // test still compiles but downstream callers benefit from the narrower
    // type. Runtime check that GB is a valid member:
    const gb: SupportedDeliveryCountry = 'GB';
    expect(gb).toBe('GB');
  });
});
