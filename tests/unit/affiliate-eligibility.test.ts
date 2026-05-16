/**
 * KAN-187: tests for the eligibility-matrix helpers.
 *
 * These are pure-function tests using a stubbed Supabase client because
 * the helpers' behaviour is determined by the SQL query they emit and the
 * shape of the result. The actual DB query is exercised at integration
 * time once KAN-190 wires the filter into the recommender.
 */

import {
  isAffiliateNetwork,
  isMerchantEligibleInCountry,
  eligibleMerchantsForCountry,
  type MerchantEligibilityRow,
} from '@/lib/affiliate/eligibility';

// ── Minimal Supabase client stub ────────────────────────────────────────
// Only the methods the helpers call. Returns canned data for the assertions.

type MockRow = Partial<MerchantEligibilityRow>;

function mockSupabase(
  matcher: (filters: Record<string, unknown>) => MockRow | MockRow[] | null,
) {
  const filters: Record<string, unknown> = {};
  const builder = {
    from(table: string) {
      filters._table = table;
      return builder;
    },
    select(_cols: string) {
      return builder;
    },
    eq(col: string, val: unknown) {
      filters[col] = val;
      return builder;
    },
    in(col: string, vals: unknown[]) {
      filters[col] = vals;
      return builder;
    },
    async maybeSingle() {
      const result = matcher(filters);
      if (!result || Array.isArray(result)) return { data: null, error: null };
      return { data: result, error: null };
    },
    then(resolve: (val: { data: MockRow[]; error: null }) => void) {
      const result = matcher(filters);
      const rows = Array.isArray(result) ? result : result ? [result] : [];
      resolve({ data: rows, error: null });
    },
  };
  // The stub is shaped like Supabase's PostgrestQueryBuilder enough for
  // our helpers' calls.
  return builder as unknown as Parameters<typeof isMerchantEligibleInCountry>[0];
}

// ── isAffiliateNetwork ──────────────────────────────────────────────────

describe('KAN-187 isAffiliateNetwork', () => {
  test('accepts the canonical networks', () => {
    for (const n of ['sovrn', 'amazon_direct', 'geniuslink', 'awin', 'ebay_partner', 'curated']) {
      expect(isAffiliateNetwork(n)).toBe(true);
    }
  });

  test('rejects unknown / casing / non-strings', () => {
    expect(isAffiliateNetwork('Sovrn')).toBe(false);
    expect(isAffiliateNetwork('cj')).toBe(false);
    expect(isAffiliateNetwork('')).toBe(false);
    expect(isAffiliateNetwork(null)).toBe(false);
    expect(isAffiliateNetwork(42)).toBe(false);
  });
});

// ── isMerchantEligibleInCountry ─────────────────────────────────────────

describe('KAN-187 isMerchantEligibleInCountry', () => {
  test('returns false for empty inputs (no DB hit)', async () => {
    const sb = mockSupabase(() => {
      throw new Error('should not be called');
    });
    expect(await isMerchantEligibleInCountry(sb, '', 'GB')).toBe(false);
    expect(await isMerchantEligibleInCountry(sb, 'amazon', '')).toBe(false);
  });

  test('returns false for malformed country codes (no DB hit)', async () => {
    const sb = mockSupabase(() => {
      throw new Error('should not be called');
    });
    expect(await isMerchantEligibleInCountry(sb, 'amazon', 'United Kingdom')).toBe(false);
    expect(await isMerchantEligibleInCountry(sb, 'amazon', 'X')).toBe(false);
  });

  test('returns true when the DB returns an active row', async () => {
    const sb = mockSupabase(() => ({ is_active: true }));
    expect(await isMerchantEligibleInCountry(sb, 'amazon', 'GB')).toBe(true);
  });

  test('returns false when no row exists', async () => {
    const sb = mockSupabase(() => null);
    expect(await isMerchantEligibleInCountry(sb, 'amazon', 'XX')).toBe(false);
  });

  test('normalises country to uppercase', async () => {
    let observed = '';
    const sb = mockSupabase((f) => {
      observed = String(f.country_code);
      return { is_active: true };
    });
    await isMerchantEligibleInCountry(sb, 'amazon', 'gb');
    expect(observed).toBe('GB');
  });
});

// ── eligibleMerchantsForCountry ─────────────────────────────────────────

describe('KAN-187 eligibleMerchantsForCountry', () => {
  test('returns an empty set for an empty candidate list (no DB hit)', async () => {
    const sb = mockSupabase(() => {
      throw new Error('should not be called');
    });
    const out = await eligibleMerchantsForCountry(sb, [], 'GB');
    expect(out.size).toBe(0);
  });

  test('returns an empty set for a malformed country code', async () => {
    const sb = mockSupabase(() => {
      throw new Error('should not be called');
    });
    const out = await eligibleMerchantsForCountry(sb, ['amazon'], 'XYZ');
    expect(out.size).toBe(0);
  });

  test('returns the intersection of input merchants and DB-eligible ones', async () => {
    const sb = mockSupabase(() => [
      { merchant_id: 'amazon' },
      { merchant_id: 'etsy' },
    ]);
    const out = await eligibleMerchantsForCountry(
      sb,
      ['amazon', 'etsy', 'made_up'],
      'GB',
    );
    expect(out.has('amazon')).toBe(true);
    expect(out.has('etsy')).toBe(true);
    expect(out.has('made_up')).toBe(false);
    expect(out.size).toBe(2);
  });

  test('passes the country code uppercase to the query', async () => {
    let observed = '';
    const sb = mockSupabase((f) => {
      observed = String(f.country_code);
      return [];
    });
    await eligibleMerchantsForCountry(sb, ['amazon'], 'de');
    expect(observed).toBe('DE');
  });
});
