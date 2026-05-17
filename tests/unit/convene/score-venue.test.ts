/**
 * KAN-207 — scoreVenue tests.
 *
 * Covers: type fit per intent, hard filters (capacity, accessibility,
 * dietary), distance scoring with both lat/lng and postcode fallbacks,
 * price tier match, prior-visits boost, diversity penalty on recent visits,
 * host rating overriding external rating.
 */

import { scoreVenue, _internal } from '@/lib/recommend/convene/score-venue';
import type { VenueCandidate, VenueContext } from '@/lib/recommend/convene/types';

const NOW = new Date('2026-06-01T12:00:00Z').getTime();
const DAY = 86400_000;

function baseCandidate(o: Partial<VenueCandidate> = {}): VenueCandidate {
  return {
    venueId: 'v1',
    name: 'Test Cafe',
    venueType: 'cafe',
    city: 'London',
    postcode: 'SW1A 1AA',
    lat: 51.5014,
    lng: -0.1419,
    priceTier: 2,
    capacityEstimate: 30,
    accessibilityFlags: [],
    dietaryFlags: [],
    externalRating: 4.0,
    ...o,
  };
}

function baseContext(o: Partial<VenueContext> = {}): VenueContext {
  return {
    intent: 'coffee',
    anchor: 'SW1A 1AA',
    capacityRequired: 4,
    required: {},
    preferred: {},
    ...o,
  };
}

describe('scoreVenue — hard filters (KAN-207)', () => {
  test('capacity too small → hardFilterFailed=capacity, score=0', () => {
    const c = baseCandidate({ capacityEstimate: 2 });
    const out = scoreVenue(c, baseContext({ capacityRequired: 6 }));
    expect(out.hardFilterFailed).toBe('capacity');
    expect(out.score).toBe(0);
  });

  test('missing required accessibility → hardFilterFailed=accessibility', () => {
    const c = baseCandidate({ accessibilityFlags: [] });
    const out = scoreVenue(
      c,
      baseContext({ required: { accessibility: ['step_free'] } })
    );
    expect(out.hardFilterFailed).toBe('accessibility');
    expect(out.reasons[0]).toContain('step_free');
  });

  test('no dietary overlap → hardFilterFailed=dietary', () => {
    const c = baseCandidate({ dietaryFlags: ['halal'] });
    const out = scoreVenue(c, baseContext({ required: { dietary: ['vegan', 'kosher'] } }));
    expect(out.hardFilterFailed).toBe('dietary');
  });

  test('partial dietary overlap → passes hard filter, lower dietaryFit', () => {
    const c = baseCandidate({ dietaryFlags: ['vegan'] });
    const out = scoreVenue(c, baseContext({ required: { dietary: ['vegan', 'gluten_free'] } }));
    expect(out.hardFilterFailed).toBeUndefined();
    expect(out.breakdown.dietaryFit).toBeLessThan(1);
    expect(out.breakdown.dietaryFit).toBeGreaterThan(0.3);
  });
});

describe('scoreVenue — type fit', () => {
  test('cafe + coffee → typeFit 1.0', () => {
    const c = baseCandidate({ venueType: 'cafe' });
    const out = scoreVenue(c, baseContext({ intent: 'coffee' }));
    expect(out.breakdown.typeFit).toBe(1.0);
  });

  test('pub + kids_party → typeFit low', () => {
    const c = baseCandidate({ venueType: 'pub' });
    const out = scoreVenue(c, baseContext({ intent: 'kids_party' }));
    expect(out.breakdown.typeFit).toBeLessThan(0.5);
  });

  test('soft_play + kids_party → typeFit 1.0', () => {
    const c = baseCandidate({ venueType: 'soft_play' });
    const out = scoreVenue(c, baseContext({ intent: 'kids_party' }));
    expect(out.breakdown.typeFit).toBe(1.0);
  });
});

describe('scoreVenue — distance', () => {
  test('lat/lng anchor — walking distance → distance 1.0', () => {
    const c = baseCandidate({ lat: 51.5014, lng: -0.1419 });
    const out = scoreVenue(c, baseContext({ anchor: '51.5014,-0.1419' }));
    expect(out.breakdown.distance).toBe(1.0);
  });

  test('lat/lng anchor — 30km away → distance very low', () => {
    const c = baseCandidate({ lat: 51.5014, lng: -0.1419 });
    const out = scoreVenue(c, baseContext({ anchor: '51.75,-0.15' })); // ~28km north
    expect(out.breakdown.distance).toBeLessThanOrEqual(0.2);
  });

  test('postcode fallback — same outward code → high distance', () => {
    const c = baseCandidate({ postcode: 'SW1A 2BB', lat: null, lng: null });
    const out = scoreVenue(c, baseContext({ anchor: 'SW1A 1AA' }));
    expect(out.breakdown.distance).toBeGreaterThanOrEqual(0.9);
  });

  test('postcode fallback — same area prefix (SW vs SW) → moderate', () => {
    const c = baseCandidate({ postcode: 'SW7 2BB', lat: null, lng: null });
    const out = scoreVenue(c, baseContext({ anchor: 'SW1A 1AA' }));
    expect(out.breakdown.distance).toBeGreaterThan(0.5);
    expect(out.breakdown.distance).toBeLessThan(0.8);
  });

  test('no anchor → neutral distance score', () => {
    const c = baseCandidate();
    const out = scoreVenue(c, baseContext({ anchor: null }));
    expect(out.breakdown.distance).toBeCloseTo(0.5, 1);
  });
});

describe('scoreVenue — price tier preference', () => {
  test('exact match → 1.0', () => {
    const c = baseCandidate({ priceTier: 2 });
    const out = scoreVenue(c, baseContext({ preferred: { priceTier: 2 } }));
    expect(out.breakdown.priceTier).toBe(1.0);
  });

  test('one tier off → 0.7', () => {
    const c = baseCandidate({ priceTier: 3 });
    const out = scoreVenue(c, baseContext({ preferred: { priceTier: 2 } }));
    expect(out.breakdown.priceTier).toBe(0.7);
  });

  test('two+ tiers off → low', () => {
    const c = baseCandidate({ priceTier: 4 });
    const out = scoreVenue(c, baseContext({ preferred: { priceTier: 1 } }));
    expect(out.breakdown.priceTier).toBeLessThan(0.5);
  });
});

describe('scoreVenue — prior visits + diversity', () => {
  test('1 prior visit → familiar boost', () => {
    const c = baseCandidate({ priorVisits: 1 });
    const out = scoreVenue(c, baseContext());
    expect(out.breakdown.priorVisits).toBeGreaterThan(0.7);
    expect(out.reasons.some((r) => /been here before/i.test(r))).toBe(true);
  });

  test('many prior visits → diversity damping', () => {
    const c = baseCandidate({ priorVisits: 6 });
    const out = scoreVenue(c, baseContext());
    expect(out.breakdown.priorVisits).toBeLessThan(0.8);
    expect(out.reasons.some((r) => /consider somewhere new/i.test(r))).toBe(true);
  });

  test('visited 3 days ago → diversityPenalty drops', () => {
    const c = baseCandidate({ lastVisitedAt: new Date(NOW - 3 * DAY).toISOString() });
    const out = scoreVenue(c, baseContext(), NOW);
    expect(out.breakdown.diversityPenalty).toBeLessThan(0.5);
  });

  test('not visited recently → diversityPenalty 1.0', () => {
    const c = baseCandidate({ lastVisitedAt: null });
    const out = scoreVenue(c, baseContext(), NOW);
    expect(out.breakdown.diversityPenalty).toBe(1.0);
  });
});

describe('scoreVenue — ratings', () => {
  test('host rating overrides external rating', () => {
    const c = baseCandidate({ externalRating: 2.0, hostRating: 5 });
    const out = scoreVenue(c, baseContext());
    expect(out.breakdown.externalRating).toBe(1.0);
    expect(out.reasons.some((r) => /Your rating/i.test(r))).toBe(true);
  });

  test('high external rating + no host rating → high score', () => {
    const c = baseCandidate({ externalRating: 4.7, hostRating: null });
    const out = scoreVenue(c, baseContext());
    expect(out.breakdown.externalRating).toBeGreaterThan(0.9);
  });
});

describe('scoreVenue — weights sanity', () => {
  test('weights sum to 1.0', () => {
    const sum = Object.values(_internal.WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 2);
  });
});

describe('haversineKm internal', () => {
  test('London to Paris ≈ 343 km', () => {
    const km = _internal.haversineKm(51.5074, -0.1278, 48.8566, 2.3522);
    expect(km).toBeGreaterThan(340);
    expect(km).toBeLessThan(346);
  });
  test('Identical points → 0', () => {
    expect(_internal.haversineKm(51.5, -0.1, 51.5, -0.1)).toBe(0);
  });
});

describe('scoreVenue — overall composite', () => {
  test('ideal venue — cafe in same postcode, comfortable size, no constraints → top score', () => {
    const c = baseCandidate({
      venueType: 'cafe',
      postcode: 'SW1A 1AA',
      capacityEstimate: 25,
      priceTier: 2,
      externalRating: 4.6,
    });
    const out = scoreVenue(
      c,
      baseContext({ anchor: 'SW1A 1AA', preferred: { priceTier: 2 }, capacityRequired: 4 })
    );
    expect(out.score).toBeGreaterThan(0.8);
  });

  test('wrong venue type far away → mediocre score', () => {
    const c = baseCandidate({
      venueType: 'pub',
      postcode: 'EH1 1AA',
      lat: 55.953,
      lng: -3.188,
      externalRating: 3.0,
    });
    const out = scoreVenue(c, baseContext({ anchor: '51.5014,-0.1419', intent: 'coffee' }));
    // Wrong type + far away should land in mediocre territory (< 0.6); we tune
    // for behaviour, not pinpoint thresholds.
    expect(out.score).toBeLessThan(0.6);
  });
});
