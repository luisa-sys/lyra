/**
 * KAN-190: tests for the V2 eligibility filter.
 *
 * Pure-function-shaped (the Supabase client is mocked). The filter's job
 * is to drop candidates whose merchant isn't in `affiliate_merchant_eligibility`
 * for the buyer's country and that can't ship to the recipient's country,
 * with a safety-net fallback when the result count would drop too low.
 */

import {
  filterCandidatesByEligibility,
  canShipTo,
} from '@/lib/recommender/v2/eligibility-filter';
import type { ProductCandidate, ConceptInput } from '@/lib/recommender/v2/types';

function concept(): ConceptInput {
  return {
    categoryKey: 'books_reading',
    conceptTitle: 'A book',
    conceptScore: 10,
    reasons: [],
    tags: [],
  };
}

function candidate(merchantId: string): ProductCandidate {
  return {
    concept: concept(),
    title: `${merchantId} item`,
    description: null,
    imageUrl: null,
    rawUrl: `https://${merchantId}.example/x`,
    merchantId,
    priceMinMinor: 1000,
    priceMaxMinor: 1000,
    priceCurrency: 'GBP',
    sourceTier: 'curated',
    rationaleFragment: null,
    sourceWeight: 0,
  };
}

/** Build a Supabase stub whose .in('merchant_id', ...) on
 *  affiliate_merchant_eligibility returns the given eligible set. */
function mockSupabase(eligibleMerchants: string[]) {
  const filters: Record<string, unknown> = {};
  const rows = eligibleMerchants.map((m) => ({ merchant_id: m }));
  const builder: Record<string, unknown> = {
    from(_: string) {
      return builder;
    },
    select(_: string) {
      return builder;
    },
    eq(col: string, val: unknown) {
      filters[col] = val;
      return builder;
    },
    in(_col: string, _vals: unknown[]) {
      return builder;
    },
    maybeSingle: async () => ({ data: null, error: null }),
    then(resolve: (val: { data: unknown[]; error: null }) => void) {
      resolve({ data: rows, error: null });
    },
  };
  return builder as unknown as Parameters<typeof filterCandidatesByEligibility>[0];
}

// ── canShipTo ───────────────────────────────────────────────────────────

describe('KAN-190 canShipTo', () => {
  test('John Lewis ships to GB only', () => {
    expect(canShipTo('johnlewis', 'GB')).toBe(true);
    expect(canShipTo('johnlewis', 'DE')).toBe(false);
  });

  test('Notonthehighstreet ships to GB + IE', () => {
    expect(canShipTo('notonthehighstreet', 'GB')).toBe(true);
    expect(canShipTo('notonthehighstreet', 'IE')).toBe(true);
    expect(canShipTo('notonthehighstreet', 'DE')).toBe(false);
  });

  test('Amazon ships to its supported storefronts', () => {
    expect(canShipTo('amazon', 'GB')).toBe(true);
    expect(canShipTo('amazon', 'US')).toBe(true);
    expect(canShipTo('amazon', 'BR')).toBe(false);
  });

  test('case-insensitive on the country code', () => {
    expect(canShipTo('johnlewis', 'gb')).toBe(true);
    expect(canShipTo('amazon', 'de')).toBe(true);
  });

  test('unknown merchant defaults to true (better over-recommend than miss)', () => {
    expect(canShipTo('made_up_merchant', 'GB')).toBe(true);
  });
});

// ── filterCandidatesByEligibility — buyer-country path ───────────────────

describe('KAN-190 filterCandidatesByEligibility — buyer eligibility', () => {
  test('empty input → empty output, no DB hit', async () => {
    const sb = mockSupabase([]);
    const out = await filterCandidatesByEligibility(sb, {
      candidates: [],
      buyerCountry: 'GB',
      recipientCountry: 'GB',
    });
    expect(out.candidates).toEqual([]);
    expect(out.droppedByEligibility).toBe(0);
    expect(out.droppedByShipping).toBe(0);
    expect(out.fellBackToUnfiltered).toBe(false);
  });

  test('all candidates eligible → no drops', async () => {
    const sb = mockSupabase(['amazon', 'etsy', 'johnlewis']);
    const out = await filterCandidatesByEligibility(sb, {
      candidates: [candidate('amazon'), candidate('etsy'), candidate('johnlewis')],
      buyerCountry: 'GB',
      recipientCountry: 'GB',
    });
    expect(out.candidates.length).toBe(3);
    expect(out.droppedByEligibility).toBe(0);
    expect(out.fellBackToUnfiltered).toBe(false);
  });

  test('drops ineligible candidates while keeping eligible ones', async () => {
    // Stub says only amazon + etsy are eligible; johnlewis is not.
    const sb = mockSupabase(['amazon', 'etsy']);
    const out = await filterCandidatesByEligibility(sb, {
      candidates: [
        candidate('amazon'),
        candidate('etsy'),
        candidate('amazon'),
        candidate('etsy'),
        candidate('johnlewis'),
      ],
      buyerCountry: 'GB',
      recipientCountry: 'GB',
    });
    expect(out.candidates.length).toBe(4);
    expect(out.droppedByEligibility).toBe(1);
    expect(out.candidates.every((c) => c.merchantId !== 'johnlewis')).toBe(true);
    expect(out.fellBackToUnfiltered).toBe(false);
  });
});

// ── filterCandidatesByEligibility — shipping path ────────────────────────

describe('KAN-190 filterCandidatesByEligibility — shipping', () => {
  test('drops candidates whose merchant cannot ship to recipient', async () => {
    // All buyer-eligible. But recipient is in DE; John Lewis ships to GB only.
    const sb = mockSupabase(['amazon', 'etsy', 'johnlewis']);
    const out = await filterCandidatesByEligibility(sb, {
      candidates: [
        candidate('amazon'),
        candidate('etsy'),
        candidate('amazon'),
        candidate('johnlewis'), // ships GB only — drop
      ],
      buyerCountry: 'GB',
      recipientCountry: 'DE',
    });
    expect(out.candidates.length).toBe(3);
    expect(out.droppedByShipping).toBe(1);
    expect(out.candidates.every((c) => c.merchantId !== 'johnlewis')).toBe(true);
  });
});

// ── filterCandidatesByEligibility — under-supply fallback ────────────────

describe('KAN-190 filterCandidatesByEligibility — under-supply fallback', () => {
  test('when filter would drop below minResults, returns pre-filter list', async () => {
    // Only amazon eligible; the other candidates would be dropped.
    // minResults=3, but only 1 candidate would survive — fallback kicks in.
    const sb = mockSupabase(['amazon']);
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const out = await filterCandidatesByEligibility(sb, {
        candidates: [
          candidate('amazon'),
          candidate('johnlewis'),
          candidate('etsy'),
        ],
        buyerCountry: 'XX',
        recipientCountry: 'XX',
        minResults: 3,
      });
      expect(out.fellBackToUnfiltered).toBe(true);
      expect(out.candidates.length).toBe(3); // all 3 returned
      expect(consoleWarnSpy).toHaveBeenCalled();
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  test('when fallback doesn\'t kick in, drop counters still report what would have been dropped', async () => {
    const sb = mockSupabase(['amazon', 'etsy', 'johnlewis']);
    const out = await filterCandidatesByEligibility(sb, {
      candidates: [
        candidate('amazon'),
        candidate('etsy'),
        candidate('amazon'),
        candidate('etsy'),
        candidate('johnlewis'),
      ],
      buyerCountry: 'GB',
      recipientCountry: 'GB',
      minResults: 3,
    });
    expect(out.fellBackToUnfiltered).toBe(false);
    expect(out.droppedByEligibility).toBe(0);
    expect(out.droppedByShipping).toBe(0);
  });
});
