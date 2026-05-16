/**
 * KAN-199 / KAN-200: tests for the V2 ranker.
 *
 * Pure functions only — no DB, no fetch. Locks the scoring formula from
 * docs/RECOMMENDATION_ENGINE_DESIGN.md and the diversity penalty so the
 * ranker stays predictable when the weights are tuned.
 */

import { rankCandidates, type RankerContext } from '@/lib/recommender/v2/rank';
import type { ProductCandidate, ConceptInput } from '@/lib/recommender/v2/types';

function concept(): ConceptInput {
  return {
    categoryKey: 'books_reading',
    conceptTitle: 'A great novel',
    conceptScore: 12,
    reasons: ['mentions reading'],
    tags: ['books'],
  };
}

function candidate(overrides: Partial<ProductCandidate> = {}): ProductCandidate {
  return {
    concept: concept(),
    title: 'Some book',
    description: null,
    imageUrl: null,
    rawUrl: 'https://uk.bookshop.org/book/abc',
    merchantId: 'bookshop_org',
    priceMinMinor: 1000,
    priceMaxMinor: 2500,
    priceCurrency: 'GBP',
    sourceTier: 'curated',
    rationaleFragment: null,
    sourceWeight: 0,
    ...overrides,
  };
}

const emptyCtx: RankerContext = {
  budgetMinMinor: null,
  budgetMaxMinor: null,
  merchantEpc: new Map(),
  shippingConfidence: new Map(),
};

describe('KAN-200 V2 ranker — score composition', () => {
  test('scores a baseline candidate with default weights', () => {
    const ranked = rankCandidates([candidate()], emptyCtx);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].score).toBeGreaterThan(0);
    expect(ranked[0].score).toBeLessThan(2);
  });

  test('breakdown sums to the total', () => {
    const ranked = rankCandidates([candidate()], emptyCtx);
    const b = ranked[0].scoreBreakdown;
    const sum =
      b.v1 + b.budget + b.merchantEpc + b.shipping + b.diversity + b.sourceTier + b.sourceWeight;
    expect(Math.abs(ranked[0].score - sum)).toBeLessThan(1e-9);
  });

  test('higher V1 conceptScore → higher V2 score (all else equal)', () => {
    const lowConcept: ConceptInput = { ...concept(), conceptScore: 5 };
    const highConcept: ConceptInput = { ...concept(), conceptScore: 25 };
    const lo = rankCandidates([candidate({ concept: lowConcept })], emptyCtx)[0];
    const hi = rankCandidates([candidate({ concept: highConcept })], emptyCtx)[0];
    expect(hi.score).toBeGreaterThan(lo.score);
  });

  test('curated tier scores higher than sovrn, which scores higher than llm', () => {
    const curated = rankCandidates([candidate({ sourceTier: 'curated' })], emptyCtx)[0];
    const sovrn = rankCandidates([candidate({ sourceTier: 'sovrn' })], emptyCtx)[0];
    const llm = rankCandidates([candidate({ sourceTier: 'llm' })], emptyCtx)[0];
    expect(curated.score).toBeGreaterThan(sovrn.score);
    expect(sovrn.score).toBeGreaterThan(llm.score);
  });
});

describe('KAN-200 V2 ranker — budget fit', () => {
  test('candidate fully above budget → reduced score', () => {
    const expensive = candidate({ priceMinMinor: 50000, priceMaxMinor: 50000 });
    const cheap = candidate({ priceMinMinor: 1000, priceMaxMinor: 1000 });
    const ranked = rankCandidates(
      [expensive, cheap],
      { ...emptyCtx, budgetMaxMinor: 5000 },
    );
    expect(ranked[0].priceMinMinor).toBe(1000);
  });

  test('candidate within budget → full budgetFit (1.0)', () => {
    const ranked = rankCandidates(
      [candidate({ priceMinMinor: 1000, priceMaxMinor: 2500 })],
      { ...emptyCtx, budgetMinMinor: 500, budgetMaxMinor: 5000 },
    );
    expect(ranked[0].scoreBreakdown.budget).toBeCloseTo(0.2);
  });

  test('candidate with no price → mid-confidence budget (0.5)', () => {
    const ranked = rankCandidates(
      [candidate({ priceMinMinor: null, priceMaxMinor: null })],
      { ...emptyCtx, budgetMaxMinor: 5000 },
    );
    expect(ranked[0].scoreBreakdown.budget).toBeCloseTo(0.1);
  });
});

describe('KAN-200 V2 ranker — merchant EPC', () => {
  test('higher EPC → higher score', () => {
    const ctxLow = { ...emptyCtx, merchantEpc: new Map([['bookshop_org', 0.1]]) };
    const ctxHigh = { ...emptyCtx, merchantEpc: new Map([['bookshop_org', 0.9]]) };
    const lo = rankCandidates([candidate()], ctxLow)[0];
    const hi = rankCandidates([candidate()], ctxHigh)[0];
    expect(hi.score).toBeGreaterThan(lo.score);
    expect(hi.score - lo.score).toBeCloseTo(0.16);
  });
});

describe('KAN-200 V2 ranker — diversity penalty', () => {
  test('2nd candidate from same merchant gets a penalty; 3rd more', () => {
    const sameMerchant = [
      candidate({ title: 'A' }),
      candidate({ title: 'B' }),
      candidate({ title: 'C' }),
    ];
    const ranked = rankCandidates(sameMerchant, emptyCtx);
    expect(ranked[0].scoreBreakdown.diversity).toBe(0);
    expect(ranked[1].scoreBreakdown.diversity).toBeLessThan(0);
    expect(ranked[2].scoreBreakdown.diversity).toBeLessThan(ranked[1].scoreBreakdown.diversity);
  });

  test('candidates from different merchants are unaffected by diversity', () => {
    const diff = [
      candidate({ merchantId: 'bookshop_org', title: 'A' }),
      candidate({ merchantId: 'etsy', title: 'B' }),
      candidate({ merchantId: 'johnlewis', title: 'C' }),
    ];
    const ranked = rankCandidates(diff, emptyCtx);
    for (const r of ranked) {
      expect(r.scoreBreakdown.diversity).toBe(0);
    }
  });

  test('mixing same and different merchants ranks by total score', () => {
    const list = [
      candidate({ merchantId: 'bookshop_org', title: 'A' }),
      candidate({ merchantId: 'bookshop_org', title: 'B' }),
      candidate({ merchantId: 'etsy', title: 'C' }),
    ];
    const ranked = rankCandidates(list, emptyCtx);
    const titles = ranked.map((r) => r.title);
    expect(titles).toEqual(['A', 'C', 'B']);
  });
});

describe('KAN-200 V2 ranker — empty + edge cases', () => {
  test('empty input → empty output', () => {
    expect(rankCandidates([], emptyCtx)).toEqual([]);
  });
});
