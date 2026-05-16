/**
 * KAN-191: tests for the V2 recommendations rendering helpers.
 *
 * Pure functions extracted from v2-recommendations-section.tsx so they
 * can be tested in the existing Node-env Jest setup (no DOM dependency).
 */

import {
  formatPriceRange,
  merchantLabel,
} from '@/app/[slug]/v2-recommendations-helpers';

describe('KAN-191 formatPriceRange — GBP', () => {
  test('range with distinct min and max → "£X–£Y"', () => {
    expect(formatPriceRange({ priceMinMinor: 1000, priceMaxMinor: 2500, priceCurrency: 'GBP' })).toBe('£10–£25');
  });

  test('range with equal min and max → "from £X"', () => {
    expect(formatPriceRange({ priceMinMinor: 1500, priceMaxMinor: 1500, priceCurrency: 'GBP' })).toBe('from £15');
  });

  test('only min → "from £X"', () => {
    expect(formatPriceRange({ priceMinMinor: 1000, priceMaxMinor: null, priceCurrency: 'GBP' })).toBe('from £10');
  });

  test('only max → "up to £X"', () => {
    expect(formatPriceRange({ priceMinMinor: null, priceMaxMinor: 5000, priceCurrency: 'GBP' })).toBe('up to £50');
  });

  test('no price → null', () => {
    expect(formatPriceRange({ priceMinMinor: null, priceMaxMinor: null, priceCurrency: null })).toBeNull();
  });
});

describe('KAN-191 formatPriceRange — non-GBP currencies', () => {
  test('USD → $', () => {
    expect(formatPriceRange({ priceMinMinor: 2500, priceMaxMinor: 5000, priceCurrency: 'USD' })).toBe('$25–$50');
  });

  test('EUR → €', () => {
    expect(formatPriceRange({ priceMinMinor: 1000, priceMaxMinor: 1000, priceCurrency: 'EUR' })).toBe('from €10');
  });

  test('unknown currency → no symbol (just numbers)', () => {
    // Defensive: a Sovrn-returned product with a currency we don't have a
    // glyph for should still produce something readable, not break the
    // render.
    expect(formatPriceRange({ priceMinMinor: 1000, priceMaxMinor: 2000, priceCurrency: 'CAD' })).toBe('10–20');
  });
});

describe('KAN-191 merchantLabel', () => {
  test('canonical ids return human labels', () => {
    expect(merchantLabel('amazon')).toBe('Amazon');
    expect(merchantLabel('etsy')).toBe('Etsy');
    expect(merchantLabel('ebay')).toBe('eBay');
    expect(merchantLabel('johnlewis')).toBe('John Lewis');
    expect(merchantLabel('notonthehighstreet')).toBe('Notonthehighstreet');
    expect(merchantLabel('bookshop_org')).toBe('Bookshop.org');
    expect(merchantLabel('otto')).toBe('Otto');
  });

  test('unknown id falls back to the id itself (never breaks render)', () => {
    expect(merchantLabel('unknown_merchant_xyz')).toBe('unknown_merchant_xyz');
  });
});
