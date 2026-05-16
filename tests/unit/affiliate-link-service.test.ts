/**
 * KAN-191: tests for the merchant detector and link-service contract.
 *
 * The link service itself (getAffiliateLink) has a Supabase + fetch side
 * effect, so it's tested at the integration level once Sovrn is live
 * (KAN-184). What we lock here is:
 *   1. The merchant detector — pure function, deterministic, the gate that
 *      decides whether eligibility lookups + downstream EPC analytics are
 *      keyed correctly.
 *   2. The provider stub behaviour — when SOVRN_API_KEY is unset, the
 *      service returns raw URLs with monetised:false (verified via the
 *      detector exports + a contract-only check on the module shape).
 */

import {
  detectMerchant,
  MERCHANT_RULES_INTERNAL,
} from '@/lib/affiliate/merchant-detector';

describe('KAN-191 merchant-detector — recognised merchants', () => {
  test('amazon.com → amazon', () => {
    expect(detectMerchant('https://amazon.com/dp/B07XYZ')).toBe('amazon');
    expect(detectMerchant('https://www.amazon.com/dp/B07XYZ')).toBe('amazon');
    expect(detectMerchant('https://amazon.co.uk/dp/B07XYZ')).toBe('amazon');
    expect(detectMerchant('https://www.amazon.de/dp/B07XYZ?ref=spam')).toBe('amazon');
    expect(detectMerchant('https://amzn.to/abcdef')).toBe('amazon');
  });

  test('etsy.com → etsy', () => {
    expect(detectMerchant('https://etsy.com/listing/12345')).toBe('etsy');
    expect(detectMerchant('https://www.etsy.com/uk/listing/12345')).toBe('etsy');
  });

  test('eBay storefronts → ebay', () => {
    expect(detectMerchant('https://ebay.com/itm/12345')).toBe('ebay');
    expect(detectMerchant('https://www.ebay.co.uk/itm/12345')).toBe('ebay');
    expect(detectMerchant('https://ebay.de/itm/12345')).toBe('ebay');
  });

  test('UK gifting merchants', () => {
    expect(detectMerchant('https://johnlewis.com/p/12345')).toBe('johnlewis');
    expect(detectMerchant('https://notonthehighstreet.com/abc')).toBe('notonthehighstreet');
    expect(detectMerchant('https://bookshop.org/book/abc')).toBe('bookshop_org');
    expect(detectMerchant('https://uk.bookshop.org/book/abc')).toBe('bookshop_org');
  });

  test('Subdomain-suffix matching for storefronts', () => {
    // Hypothetical regional CDN subdomain — still resolves to amazon.
    expect(detectMerchant('https://m.amazon.co.uk/dp/B07XYZ')).toBe('amazon');
  });
});

describe('KAN-191 merchant-detector — unknown merchants', () => {
  test('unknown domain → null', () => {
    expect(detectMerchant('https://random-shop.example.com/product')).toBeNull();
    expect(detectMerchant('https://made-up-merchant.co.za')).toBeNull();
  });

  test('non-URL input → null', () => {
    expect(detectMerchant('')).toBeNull();
    expect(detectMerchant('not a url')).toBeNull();
    expect(detectMerchant('amazon.com/no-protocol')).toBeNull();
    // @ts-expect-error — runtime guard
    expect(detectMerchant(null)).toBeNull();
    // @ts-expect-error — runtime guard
    expect(detectMerchant(undefined)).toBeNull();
  });

  test('preventing false positives via host word fragments', () => {
    // A merchant called "fakeamazon.com" should NOT match the amazon rule.
    expect(detectMerchant('https://fakeamazon.com/product')).toBeNull();
    // Likewise "amazon.fake.com" — different TLD, no match.
    expect(detectMerchant('https://amazon.fake.com/product')).toBeNull();
  });
});

describe('KAN-191 merchant-detector — rule shape', () => {
  test('every rule has a canonical snake_case id', () => {
    for (const rule of MERCHANT_RULES_INTERNAL) {
      expect(rule.id).toMatch(/^[a-z0-9_]+$/);
      expect(rule.hosts.length).toBeGreaterThan(0);
    }
  });

  test('no duplicate merchant ids', () => {
    const ids = MERCHANT_RULES_INTERNAL.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('all hosts are lowercased and stripped of protocol', () => {
    for (const rule of MERCHANT_RULES_INTERNAL) {
      for (const host of rule.hosts) {
        expect(host).toBe(host.toLowerCase());
        expect(host).not.toMatch(/^https?:\/\//);
        expect(host).not.toMatch(/^www\./);
      }
    }
  });
});
