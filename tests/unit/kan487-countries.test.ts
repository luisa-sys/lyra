/**
 * KAN-487 — country dropdown list (spec v0.8 §01 "About Me": "Country
 * (optional)"; founder decision 2026-11-22: dropdown, stored as the 2-letter
 * ISO code). Expected values are literals, never read from the module.
 */

import { COUNTRIES, countryName, isCountryCode } from '@/modules/profile/countries';

describe('KAN-487 countries — COUNTRIES', () => {
  test('is non-empty and covers ISO 3166-1 alpha-2 (245..252 entries)', () => {
    expect(COUNTRIES.length).toBeGreaterThanOrEqual(245);
    expect(COUNTRIES.length).toBeLessThanOrEqual(252);
  });

  test.each([
    ['GB', 'United Kingdom'],
    ['US', 'United States'],
    ['IE', 'Ireland'],
    ['FR', 'France'],
    ['DE', 'Germany'],
    ['JP', 'Japan'],
  ])('%s is listed as %s', (code, name) => {
    expect(COUNTRIES).toContainEqual({ code, name });
  });

  test('every code is two upper-case letters', () => {
    expect(COUNTRIES.length).toBeGreaterThan(0);
    for (const c of COUNTRIES) expect(c.code).toMatch(/^[A-Z]{2}$/);
  });

  test('every name is a non-empty trimmed string', () => {
    for (const c of COUNTRIES) {
      expect(c.name.trim()).toBe(c.name);
      expect(c.name.length).toBeGreaterThan(0);
    }
  });

  test('codes are unique', () => {
    const codes = COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  test('names are unique', () => {
    const names = COUNTRIES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('sorted by name (English collation)', () => {
    for (let i = 1; i < COUNTRIES.length; i++) {
      expect(COUNTRIES[i - 1].name.localeCompare(COUNTRIES[i].name, 'en')).toBeLessThan(0);
    }
  });

  test('ordering spot check: Ireland before Japan before United Kingdom before United States', () => {
    const idx = (code: string) => COUNTRIES.findIndex((c) => c.code === code);
    expect(idx('IE')).toBeLessThan(idx('JP'));
    expect(idx('JP')).toBeLessThan(idx('GB'));
    expect(idx('GB')).toBeLessThan(idx('US'));
  });
});

describe('KAN-487 countries — isCountryCode', () => {
  test.each(['GB', 'US', 'IE', 'FR', 'DE', 'JP'])('%s is a country code', (code) => {
    expect(isCountryCode(code)).toBe(true);
  });

  test.each(['gb', 'UK', 'XX', 'GBR', 'G', '', ' GB', null, undefined, 44])(
    '%p is not a country code',
    (value) => {
      expect(isCountryCode(value)).toBe(false);
    },
  );
});

describe('KAN-487 countries — countryName', () => {
  test('GB is United Kingdom', () => {
    expect(countryName('GB')).toBe('United Kingdom');
  });

  test('JP is Japan', () => {
    expect(countryName('JP')).toBe('Japan');
  });

  test.each(['UK', 'gb', 'XX', '', null, undefined])('%p has no name', (code) => {
    expect(countryName(code)).toBeNull();
  });
});
