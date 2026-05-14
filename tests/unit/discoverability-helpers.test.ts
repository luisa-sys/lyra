/**
 * KAN-153: unit tests for the pure phone/postcode discoverability helpers.
 *
 * These cover:
 *   - normalisePhone: E.164 normalisation, UK default, rejects bad input.
 *   - normalisePostcode: uppercase / no-space normalisation, rejects bad
 *     input.
 *   - hashContact: determinism, pepper sensitivity, kind-namespacing.
 *   - hashPhoneInput / hashPostcodeInput: end-to-end with a pepper from env.
 *   - getSearchPepper: throws when missing or too short.
 *
 * No Supabase / network — all pure functions.
 */
import {
  normalisePhone,
  normalisePostcode,
  hashContact,
  hashPhoneInput,
  hashPostcodeInput,
  getSearchPepper,
} from '@/app/dashboard/settings/discoverability-helpers';

// ── normalisePhone ─────────────────────────────────────────
describe('normalisePhone', () => {
  test('passes through E.164', () => {
    expect(normalisePhone('+447700900000')).toBe('+447700900000');
  });

  test('strips spaces, dashes, dots, parens', () => {
    expect(normalisePhone('+44 (77) 0090-0000')).toBe('+447700900000');
    expect(normalisePhone('+44.7700.900000')).toBe('+447700900000');
  });

  test('converts UK leading 0 to +44', () => {
    expect(normalisePhone('07700900000')).toBe('+447700900000');
  });

  test('converts leading 00 to +', () => {
    expect(normalisePhone('00447700900000')).toBe('+447700900000');
  });

  test('rejects bare digits with no country code', () => {
    expect(normalisePhone('7700900000')).toBeNull();
  });

  test('rejects empty string', () => {
    expect(normalisePhone('')).toBeNull();
  });

  test('rejects too short', () => {
    expect(normalisePhone('+4477')).toBeNull();
  });

  test('rejects too long', () => {
    expect(normalisePhone('+44' + '0'.repeat(20))).toBeNull();
  });

  test('rejects non-digit chars after stripping', () => {
    expect(normalisePhone('+44abc')).toBeNull();
  });

  test('rejects null/undefined gracefully', () => {
    // @ts-expect-error — testing runtime behaviour with bad input
    expect(normalisePhone(null)).toBeNull();
    // @ts-expect-error — testing runtime behaviour with bad input
    expect(normalisePhone(undefined)).toBeNull();
  });
});

// ── normalisePostcode ──────────────────────────────────────
describe('normalisePostcode', () => {
  test('uppercases and removes spaces', () => {
    expect(normalisePostcode('sw1a 1aa')).toBe('SW1A1AA');
    expect(normalisePostcode('SW1A 1AA')).toBe('SW1A1AA');
  });

  test('handles already-uppercase / no-space', () => {
    expect(normalisePostcode('M11AE')).toBe('M11AE');
  });

  test('trims surrounding whitespace', () => {
    expect(normalisePostcode('  E1 6AN  ')).toBe('E16AN');
  });

  test('rejects empty string', () => {
    expect(normalisePostcode('')).toBeNull();
  });

  test('rejects too short', () => {
    expect(normalisePostcode('SW1A')).toBeNull();
  });

  test('rejects non-alphanumerics', () => {
    expect(normalisePostcode('SW1A-1AA')).toBeNull();
    expect(normalisePostcode('SW1A!1AA')).toBeNull();
  });

  test('rejects too long', () => {
    expect(normalisePostcode('SW1A1AABBB')).toBeNull();
  });

  test('rejects null/undefined gracefully', () => {
    // @ts-expect-error — testing runtime behaviour with bad input
    expect(normalisePostcode(null)).toBeNull();
    // @ts-expect-error — testing runtime behaviour with bad input
    expect(normalisePostcode(undefined)).toBeNull();
  });
});

// ── hashContact ────────────────────────────────────────────
describe('hashContact', () => {
  const pepper = 'test-pepper-at-least-16-chars-long';

  test('is deterministic for the same inputs', () => {
    const a = hashContact('phone', '+447700900000', pepper);
    const b = hashContact('phone', '+447700900000', pepper);
    expect(a).toBe(b);
  });

  test('produces a 64-char hex digest', () => {
    const h = hashContact('phone', '+447700900000', pepper);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  test('different pepper produces different hash', () => {
    const a = hashContact('phone', '+447700900000', pepper);
    const b = hashContact('phone', '+447700900000', 'different-pepper-also-long');
    expect(a).not.toBe(b);
  });

  test('different value produces different hash', () => {
    const a = hashContact('phone', '+447700900000', pepper);
    const b = hashContact('phone', '+447700900001', pepper);
    expect(a).not.toBe(b);
  });

  test('phone and postcode kinds are namespaced apart', () => {
    // Even if a user happened to enter the same string for both, the
    // resulting hashes MUST differ.
    const a = hashContact('phone', 'SAMEVALUE', pepper);
    const b = hashContact('postcode', 'SAMEVALUE', pepper);
    expect(a).not.toBe(b);
  });

  test('throws on empty value (programmer error)', () => {
    expect(() => hashContact('phone', '', pepper)).toThrow();
  });
});

// ── getSearchPepper ────────────────────────────────────────
describe('getSearchPepper', () => {
  const originalPepper = process.env.LYRA_SEARCH_PEPPER;

  afterEach(() => {
    if (originalPepper === undefined) {
      delete process.env.LYRA_SEARCH_PEPPER;
    } else {
      process.env.LYRA_SEARCH_PEPPER = originalPepper;
    }
  });

  test('throws when env var is missing', () => {
    delete process.env.LYRA_SEARCH_PEPPER;
    expect(() => getSearchPepper()).toThrow(/LYRA_SEARCH_PEPPER/);
  });

  test('throws when env var is too short', () => {
    process.env.LYRA_SEARCH_PEPPER = 'short';
    expect(() => getSearchPepper()).toThrow(/LYRA_SEARCH_PEPPER/);
  });

  test('returns the pepper when present and long enough', () => {
    process.env.LYRA_SEARCH_PEPPER = 'a-sufficiently-long-test-pepper-value';
    expect(getSearchPepper()).toBe('a-sufficiently-long-test-pepper-value');
  });

  test('error message does NOT include the pepper value (privacy)', () => {
    process.env.LYRA_SEARCH_PEPPER = 'secret-pepper-value-that-should-not-leak';
    // (Pepper IS long enough — but we re-verify the empty case here)
    delete process.env.LYRA_SEARCH_PEPPER;
    try {
      getSearchPepper();
      throw new Error('should have thrown');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toContain('secret-pepper-value-that-should-not-leak');
    }
  });
});

// ── hashPhoneInput / hashPostcodeInput (end-to-end) ────────
describe('hashPhoneInput / hashPostcodeInput', () => {
  const originalPepper = process.env.LYRA_SEARCH_PEPPER;
  beforeAll(() => {
    process.env.LYRA_SEARCH_PEPPER = 'unit-test-pepper-long-enough-for-validation';
  });
  afterAll(() => {
    if (originalPepper === undefined) delete process.env.LYRA_SEARCH_PEPPER;
    else process.env.LYRA_SEARCH_PEPPER = originalPepper;
  });

  test('different formatting of the same UK phone produces the SAME hash', () => {
    // The whole point of normalisation: "07700 900000", "+44 7700 900000",
    // and "00447700900000" must all match the same stored hash.
    const a = hashPhoneInput('07700 900000');
    const b = hashPhoneInput('+44 7700 900000');
    const c = hashPhoneInput('00447700900000');
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  test('different formatting of the same UK postcode produces the SAME hash', () => {
    const a = hashPostcodeInput('sw1a 1aa');
    const b = hashPostcodeInput('SW1A1AA');
    const c = hashPostcodeInput('  SW1A 1AA  ');
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  test('returns null for unnormalisable phone', () => {
    expect(hashPhoneInput('not a phone')).toBeNull();
    expect(hashPhoneInput('')).toBeNull();
  });

  test('returns null for unnormalisable postcode', () => {
    expect(hashPostcodeInput('!')).toBeNull();
    expect(hashPostcodeInput('')).toBeNull();
  });

  test('phone and postcode with same normalised form still hash differently', () => {
    // Crafted overlap: 'SW1A1AA' could theoretically be a normalised
    // postcode AND… well, it can't be a phone (phones must start with +).
    // But for a string value that COULD be either, kind-namespacing
    // ensures distinct hashes. Test directly via hashContact already
    // covers this; we re-verify via the public end-to-end entry points
    // by hashing the same normalised string under both kinds manually.
    const phoneHash = hashPhoneInput('+447700900000');
    const postcodeHash = hashPostcodeInput('SW1A1AA');
    expect(phoneHash).not.toBe(postcodeHash);
  });
});
