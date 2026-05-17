/**
 * KAN-207 — scoreAttendee tests.
 *
 * Table-driven: each test sets up a candidate + context, asserts the score
 * range OR the dominant reason fragment. The exact weights are not asserted
 * (they'll evolve); we test the BEHAVIOUR — does a recent no-show drop
 * below 0.3? Does a sweet-spot recency push above 0.7? Etc.
 */

import { scoreAttendee, _internal } from '@/lib/recommend/convene/score-attendee';
import type {
  AttendeeCandidate,
  AttendeeContext,
  RelationshipSignals,
} from '@/lib/recommend/convene/types';

const NOW = new Date('2026-06-01T12:00:00Z').getTime();

function daysAgo(d: number): string {
  return new Date(NOW - d * 86400_000).toISOString();
}

function baseCandidate(overrides: Partial<AttendeeCandidate> = {}): AttendeeCandidate {
  return {
    contactId: 'c1',
    displayName: 'Alice',
    city: 'London',
    hasLinkedProfile: false,
    tribeNames: [],
    ...overrides,
  };
}

function baseContext(overrides: Partial<AttendeeContext> = {}): AttendeeContext {
  return {
    intent: 'coffee',
    existingInviteeContactIds: [],
    ...overrides,
  };
}

function baseSignals(overrides: Partial<RelationshipSignals> = {}): RelationshipSignals {
  return {
    totalInvites: 0,
    totalAccepted: 0,
    totalAttended: 0,
    totalDeclined: 0,
    totalSilent: 0,
    totalNoShows: 0,
    lastAttendedAt: null,
    lastInvitedAt: null,
    gatheringTypeDiversity: 0,
    gatheringTypesSeen: [],
    ...overrides,
  };
}

describe('scoreAttendee — KAN-207', () => {
  describe('exclusion', () => {
    test('already on invite list → score 0 + excluded=true', () => {
      const ctx = baseContext({ existingInviteeContactIds: ['c1'] });
      const out = scoreAttendee(baseCandidate(), ctx, NOW);
      expect(out.score).toBe(0);
      expect(out.excluded).toBe(true);
      expect(out.excludedReason).toBe('already_invited');
    });
  });

  describe('tribe fit', () => {
    test('tribe name matches intent keyword → boost', () => {
      const c = baseCandidate({ tribeNames: ['uni friends'] });
      const out = scoreAttendee(c, baseContext({ intent: 'coffee' }), NOW);
      expect(out.breakdown.tribeFit).toBeGreaterThan(0.5);
      expect(out.reasons.some((r) => r.includes('uni friends'))).toBe(true);
    });

    test('kids_party + "school parents" tribe → strong boost', () => {
      const c = baseCandidate({ tribeNames: ['school parents'] });
      const out = scoreAttendee(c, baseContext({ intent: 'kids_party' }), NOW);
      expect(out.breakdown.tribeFit).toBeGreaterThanOrEqual(0.6);
    });

    test('no relevant tribe → mid-low tribeFit', () => {
      const c = baseCandidate({ tribeNames: ['neighbours'] });
      const out = scoreAttendee(c, baseContext({ intent: 'coffee' }), NOW);
      expect(out.breakdown.tribeFit).toBeLessThan(0.5);
    });
  });

  describe('recency', () => {
    test('recent (5 days) → dampens to avoid over-asking', () => {
      const c = baseCandidate({
        signals: baseSignals({ lastAttendedAt: daysAgo(5), totalAttended: 1, totalInvites: 1, totalAccepted: 1 }),
      });
      const out = scoreAttendee(c, baseContext(), NOW);
      expect(out.breakdown.recency).toBeLessThan(0.5);
      expect(out.reasons.some((r) => /recent/i.test(r))).toBe(true);
    });

    test('sweet spot (60 days) → strong recency score', () => {
      const c = baseCandidate({
        signals: baseSignals({ lastAttendedAt: daysAgo(60), totalAttended: 1, totalInvites: 1, totalAccepted: 1 }),
      });
      const out = scoreAttendee(c, baseContext(), NOW);
      expect(out.breakdown.recency).toBeGreaterThan(0.9);
    });

    test('overdue (220 days) → re-engagement boost', () => {
      const c = baseCandidate({
        signals: baseSignals({ lastAttendedAt: daysAgo(220), totalAttended: 1, totalInvites: 1, totalAccepted: 1 }),
      });
      const out = scoreAttendee(c, baseContext(), NOW);
      expect(out.breakdown.recency).toBeGreaterThan(0.6);
      expect(out.reasons.some((r) => /overdue/i.test(r))).toBe(true);
    });

    test('never gathered → neutral baseline', () => {
      const c = baseCandidate({ signals: baseSignals({ lastAttendedAt: null }) });
      const out = scoreAttendee(c, baseContext(), NOW);
      expect(out.breakdown.recency).toBeCloseTo(0.5, 1);
    });
  });

  describe('response history', () => {
    test('high acceptance ratio + ≥3 invites → boosts to 1.0', () => {
      const c = baseCandidate({
        signals: baseSignals({
          totalInvites: 5,
          totalAccepted: 5,
          totalAttended: 5,
          gatheringTypesSeen: ['coffee'],
        }),
      });
      const out = scoreAttendee(c, baseContext(), NOW);
      expect(out.breakdown.responseHistory).toBeGreaterThanOrEqual(0.9);
    });

    test('multiple no-shows → dampens hard', () => {
      const c = baseCandidate({
        signals: baseSignals({ totalInvites: 5, totalAccepted: 5, totalAttended: 2, totalNoShows: 3 }),
      });
      const out = scoreAttendee(c, baseContext(), NOW);
      expect(out.breakdown.responseHistory).toBeLessThanOrEqual(0.3);
      expect(out.reasons.some((r) => /flaky/i.test(r))).toBe(true);
    });
  });

  describe('type fit', () => {
    test('has done this type before → strong fit', () => {
      const c = baseCandidate({
        signals: baseSignals({ totalInvites: 1, totalAttended: 1, gatheringTypesSeen: ['coffee'] }),
      });
      const out = scoreAttendee(c, baseContext({ intent: 'coffee' }), NOW);
      expect(out.breakdown.typeFit).toBeGreaterThanOrEqual(0.9);
    });

    test('has done other types but not this one → moderate', () => {
      const c = baseCandidate({
        signals: baseSignals({ totalInvites: 2, totalAttended: 2, gatheringTypesSeen: ['dinner', 'lunch'] }),
      });
      const out = scoreAttendee(c, baseContext({ intent: 'coffee' }), NOW);
      expect(out.breakdown.typeFit).toBeGreaterThan(0.5);
      expect(out.breakdown.typeFit).toBeLessThan(0.9);
    });
  });

  describe('diversity', () => {
    test('invited many times → diversity dampens', () => {
      const c = baseCandidate({
        signals: baseSignals({ totalInvites: 10, totalAccepted: 8, totalAttended: 8, lastAttendedAt: daysAgo(60) }),
      });
      const out = scoreAttendee(c, baseContext(), NOW);
      expect(out.breakdown.diversity).toBeLessThanOrEqual(0.6);
      expect(out.reasons.some((r) => /mixing it up/i.test(r))).toBe(true);
    });

    test('new candidate → max diversity', () => {
      const c = baseCandidate({ signals: baseSignals() });
      const out = scoreAttendee(c, baseContext(), NOW);
      expect(out.breakdown.diversity).toBe(1.0);
    });
  });

  describe('overall composite', () => {
    test('ideal candidate (tribe + recency sweet spot + reliable + same type before) → top of range', () => {
      const c = baseCandidate({
        tribeNames: ['uni friends'],
        signals: baseSignals({
          totalInvites: 4,
          totalAccepted: 4,
          totalAttended: 4,
          gatheringTypesSeen: ['coffee'],
          lastAttendedAt: daysAgo(60),
        }),
      });
      const out = scoreAttendee(c, baseContext({ intent: 'coffee' }), NOW);
      expect(out.score).toBeGreaterThan(0.8);
      expect(out.reasons.length).toBeGreaterThan(2);
    });

    test('weak candidate (no tribe + no history + new) → mid-range', () => {
      const c = baseCandidate({ tribeNames: [], signals: undefined });
      const out = scoreAttendee(c, baseContext({ intent: 'other' }), NOW);
      expect(out.score).toBeGreaterThan(0.2);
      expect(out.score).toBeLessThan(0.7);
    });

    test('flaky candidate (no-shows + over-invited) → low score', () => {
      const c = baseCandidate({
        signals: baseSignals({
          totalInvites: 8,
          totalAccepted: 5,
          totalAttended: 2,
          totalNoShows: 3,
          lastAttendedAt: daysAgo(300),
        }),
      });
      const out = scoreAttendee(c, baseContext({ intent: 'coffee' }), NOW);
      expect(out.score).toBeLessThan(0.5);
    });
  });

  describe('weights sum sanity', () => {
    test('weights add up to 1.0', () => {
      const sum = Object.values(_internal.WEIGHTS).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 2);
    });
  });
});
