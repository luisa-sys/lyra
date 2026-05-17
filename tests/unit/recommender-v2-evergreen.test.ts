/**
 * Tests for the evergreen always-show fallback in the V2 recommender.
 *
 * The fallback exists so the recommender NEVER returns an empty list when
 * the curated catalogue (KAN-200) has at least one matching entry. It
 * substitutes a fixed set of safe-default concepts when:
 *   1. V1 produced 0 concepts (sparse profile), OR
 *   2. V1 produced concepts but candidate-sourcing returned 0 candidates
 *      (no Tier-1 catalogue match in the buyer's country, Sovrn / LLM
 *      stubs returning nothing).
 *
 * These tests cover the evergreen module's shape + the type guard.
 * The pipeline integration (which mixes the IO-backed candidate-sourcing
 * + affiliate link service) is verified by the integration-level functional
 * tests against dev that exercise the V2 endpoint end-to-end.
 */

import {
  EVERGREEN_FALLBACK_CONCEPTS,
  isEvergreenFallback,
} from '@/lib/recommender/v2/evergreen';
import type { ConceptInput, ProductCandidate } from '@/lib/recommender/v2/types';

describe('EVERGREEN_FALLBACK_CONCEPTS — shape invariants', () => {
  test('has at least 3 concepts so the fallback always produces a reasonable spread', () => {
    expect(EVERGREEN_FALLBACK_CONCEPTS.length).toBeGreaterThanOrEqual(3);
  });

  test('every concept is tagged "evergreen" so isEvergreenFallback can detect them', () => {
    for (const c of EVERGREEN_FALLBACK_CONCEPTS) {
      expect(c.tags).toContain('evergreen');
    }
  });

  test('every concept also tagged "safe-default" — documentary signal for telemetry', () => {
    for (const c of EVERGREEN_FALLBACK_CONCEPTS) {
      expect(c.tags).toContain('safe-default');
    }
  });

  test('scores are low (≤ 5) so real-profile concepts always outrank evergreen ones', () => {
    // Real V1 concept scores are typically 8–20. If a profile is rich enough
    // to produce a real concept at score 7 (rare but possible), the
    // evergreen entry at score 5 still loses — that's the intent. Don't
    // raise this above 5 without re-checking V1's scoring distribution.
    for (const c of EVERGREEN_FALLBACK_CONCEPTS) {
      expect(c.conceptScore).toBeLessThanOrEqual(5);
    }
  });

  test('every category maps onto a seeded recommender_catalogue category', () => {
    // The seed data (KAN-200 + Phase-1 catalogue migration) covers these
    // categories. If a future PR drops one, the evergreen fallback for that
    // category produces 0 candidates and the fallback is less reliable —
    // catch the drift here.
    const seededCategories = new Set([
      'books_reading',
      'arts_crafts',
      'experiences',
      'food_drink',
      'home_garden',
    ]);
    for (const c of EVERGREEN_FALLBACK_CONCEPTS) {
      expect(seededCategories.has(c.categoryKey)).toBe(true);
    }
  });

  test('rationale strings + titles are non-empty so the explainer has something to work with', () => {
    for (const c of EVERGREEN_FALLBACK_CONCEPTS) {
      expect(c.conceptTitle.length).toBeGreaterThan(0);
      expect(c.reasons.length).toBeGreaterThan(0);
      expect(c.reasons[0].length).toBeGreaterThan(10);
    }
  });
});

// ── isEvergreenFallback ────────────────────────────────────────────────

function fakeCandidate(concept: ConceptInput): ProductCandidate {
  return {
    concept,
    title: 'mock',
    description: null,
    imageUrl: null,
    rawUrl: 'https://example.com/x',
    merchantId: 'mock',
    priceMinMinor: null,
    priceMaxMinor: null,
    priceCurrency: null,
    sourceTier: 'curated',
    rationaleFragment: null,
    sourceWeight: 0,
  };
}

describe('isEvergreenFallback — telemetry helper', () => {
  test('empty input → false (nothing to fall back from)', () => {
    expect(isEvergreenFallback([])).toBe(false);
  });

  test('all candidates from evergreen concepts → true', () => {
    const candidates = EVERGREEN_FALLBACK_CONCEPTS.map(fakeCandidate);
    expect(isEvergreenFallback(candidates)).toBe(true);
  });

  test('mixed real + evergreen → false', () => {
    const real: ConceptInput = {
      categoryKey: 'books_reading',
      conceptTitle: 'A novel about ___',
      conceptScore: 15,
      reasons: ['from profile likes'],
      tags: ['v1-derived'],
    };
    const mixed = [fakeCandidate(real), fakeCandidate(EVERGREEN_FALLBACK_CONCEPTS[0])];
    expect(isEvergreenFallback(mixed)).toBe(false);
  });

  test('all real concepts → false', () => {
    const real: ConceptInput = {
      categoryKey: 'books_reading',
      conceptTitle: 'A novel about ___',
      conceptScore: 15,
      reasons: ['from profile likes'],
      tags: ['v1-derived'],
    };
    expect(isEvergreenFallback([fakeCandidate(real)])).toBe(false);
  });
});
