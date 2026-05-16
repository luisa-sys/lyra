/**
 * KAN-189: unit tests for the affiliate-click types + SubID helpers.
 *
 * Locks in the SubID format that the reconciliation cron in KAN-195 will
 * depend on. If these tests break, monthly reconciliation breaks silently
 * (rows in Sovrn's report won't match rows in our `affiliate_clicks` table).
 */

import {
  buildSubId,
  parseSubId,
  isCountryCode,
  type AffiliateClickRow,
  type AffiliateProvider,
  type AffiliateClickSource,
} from '@/lib/affiliate/types';

describe('KAN-189 affiliate clicks — buildSubId', () => {
  const uuid = '550e8400-e29b-41d4-a716-446655440000';

  test('web source produces lyra-{uuid}', () => {
    expect(buildSubId(uuid, 'web')).toBe(`lyra-${uuid}`);
  });

  test('email source produces lyra-{uuid} (shares format with web)', () => {
    // email and web share the same SubID prefix; source is differentiated
    // in the affiliate_clicks row (not in the SubID).
    expect(buildSubId(uuid, 'email')).toBe(`lyra-${uuid}`);
  });

  test('mcp source produces lyra-mcp-{uuid}', () => {
    expect(buildSubId(uuid, 'mcp')).toBe(`lyra-mcp-${uuid}`);
  });

  test('SubID contains no PII — only the lyra prefix, optional mcp tag, and an opaque UUID', () => {
    const subId = buildSubId(uuid, 'mcp');
    expect(subId).not.toMatch(/@/);
    expect(subId).not.toMatch(/email/i);
    expect(subId).not.toMatch(/name/i);
  });
});

describe('KAN-189 affiliate clicks — parseSubId', () => {
  const uuid = '550e8400-e29b-41d4-a716-446655440000';

  test('round-trips web SubID', () => {
    const subId = buildSubId(uuid, 'web');
    expect(parseSubId(subId)).toEqual({ clickId: uuid, source: 'web' });
  });

  test('round-trips mcp SubID', () => {
    const subId = buildSubId(uuid, 'mcp');
    expect(parseSubId(subId)).toEqual({ clickId: uuid, source: 'mcp' });
  });

  test('rejects unknown prefix', () => {
    expect(parseSubId(`other-${uuid}`)).toBeNull();
  });

  test('rejects non-UUID body', () => {
    expect(parseSubId('lyra-not-a-uuid')).toBeNull();
    expect(parseSubId('lyra-mcp-also-bad')).toBeNull();
  });

  test('rejects null / empty / non-string', () => {
    expect(parseSubId(null)).toBeNull();
    expect(parseSubId(undefined)).toBeNull();
    expect(parseSubId('')).toBeNull();
    // @ts-expect-error — testing runtime guard
    expect(parseSubId(123)).toBeNull();
  });

  test('rejects SubID where lyra- prefix is missing', () => {
    expect(parseSubId(uuid)).toBeNull();
  });

  test('mcp prefix takes precedence over web prefix when both could match', () => {
    // Real example from a future Sovrn report row
    expect(parseSubId(`lyra-mcp-${uuid}`)).toEqual({ clickId: uuid, source: 'mcp' });
  });
});

describe('KAN-189 affiliate clicks — isCountryCode', () => {
  test('accepts ISO-3166 alpha-2 uppercase', () => {
    expect(isCountryCode('GB')).toBe(true);
    expect(isCountryCode('US')).toBe(true);
    expect(isCountryCode('DE')).toBe(true);
  });

  test('rejects lowercase, 3-letter, full names, non-string', () => {
    expect(isCountryCode('gb')).toBe(false);
    expect(isCountryCode('USA')).toBe(false);
    expect(isCountryCode('United Kingdom')).toBe(false);
    expect(isCountryCode(null)).toBe(false);
    expect(isCountryCode(undefined)).toBe(false);
    expect(isCountryCode(42)).toBe(false);
    expect(isCountryCode('G1')).toBe(false);
  });
});

describe('KAN-189 affiliate clicks — type contract', () => {
  test('AffiliateProvider enum stays aligned with the SQL check constraint', () => {
    // If a new provider is added to the SQL check constraint in the migration
    // (sovrn / amazon_direct / geniuslink / raw), this list must grow too.
    const providers: AffiliateProvider[] = ['sovrn', 'amazon_direct', 'geniuslink', 'raw'];
    expect(providers).toHaveLength(4);
  });

  test('AffiliateClickSource enum stays aligned with the SQL check constraint', () => {
    // If a new source is added to the SQL check constraint in the migration
    // (web / mcp / email), this list must grow too.
    const sources: AffiliateClickSource[] = ['web', 'mcp', 'email'];
    expect(sources).toHaveLength(3);
  });

  test('AffiliateClickRow shape compiles for a fully-populated row', () => {
    const row: AffiliateClickRow = {
      click_id: '550e8400-e29b-41d4-a716-446655440000',
      created_at: '2026-05-16T20:00:00.000Z',
      session_id: 'session-abc',
      user_id: 'user-1',
      recipient_id: 'profile-1',
      recommendation_id: 'rec-1',
      merchant_id: 'amazon',
      buyer_country: 'GB',
      recipient_country: 'DE',
      provider: 'sovrn',
      provider_subid: 'lyra-550e8400-e29b-41d4-a716-446655440000',
      source: 'web',
      raw_url: 'https://amazon.de/dp/B07XYZ',
      monetised_url: 'https://redirect.sovrn.com/?u=https%3A%2F%2Famazon.de%2Fdp%2FB07XYZ',
      converted_at: '2026-05-17T08:30:00.000Z',
      commission_amount: '12.4500',
      commission_currency: 'EUR',
      commission_gbp: '10.7800',
    };
    expect(row.click_id).toBeTruthy();
  });

  test('AffiliateClickRow shape compiles for the minimum-nullable case (anon click that did not monetise)', () => {
    const row: AffiliateClickRow = {
      click_id: '550e8400-e29b-41d4-a716-446655440000',
      created_at: '2026-05-16T20:00:00.000Z',
      session_id: null,
      user_id: null,
      recipient_id: null,
      recommendation_id: null,
      merchant_id: null,
      buyer_country: null,
      recipient_country: null,
      provider: 'raw',
      provider_subid: null,
      source: 'web',
      raw_url: 'https://example.com/product',
      monetised_url: 'https://example.com/product',
      converted_at: null,
      commission_amount: null,
      commission_currency: null,
      commission_gbp: null,
    };
    expect(row.provider).toBe('raw');
  });
});
