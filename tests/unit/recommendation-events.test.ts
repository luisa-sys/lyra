/**
 * KAN-202: tests for the recommendation_events helpers.
 *
 * Locks the enum alignment with the SQL CHECK constraint and the metadata
 * sanitiser which is the last-line defence between user-supplied feedback
 * payloads and the `metadata jsonb` column.
 */

import {
  RECOMMENDATION_EVENT_TYPES,
  isRecommendationEventType,
  isRecommendationEventSource,
  sanitiseEventMetadata,
} from '@/lib/recommender/events';

describe('KAN-202 recommendation events — RECOMMENDATION_EVENT_TYPES', () => {
  test('matches the SQL CHECK constraint exactly', () => {
    // If you change the event-types here, also change the constraint in
    // supabase/migrations/20260516230000_recommendation_events.sql.
    expect([...RECOMMENDATION_EVENT_TYPES]).toEqual([
      'shown',
      'clicked',
      'converted',
      'thumbs_up',
      'thumbs_down',
      'hidden',
    ]);
  });
});

describe('KAN-202 recommendation events — isRecommendationEventType', () => {
  test('accepts every canonical event type', () => {
    for (const t of RECOMMENDATION_EVENT_TYPES) {
      expect(isRecommendationEventType(t)).toBe(true);
    }
  });

  test('rejects unknown / casing variants', () => {
    expect(isRecommendationEventType('SHOWN')).toBe(false);
    expect(isRecommendationEventType('liked')).toBe(false);
    expect(isRecommendationEventType('')).toBe(false);
    expect(isRecommendationEventType(null)).toBe(false);
    expect(isRecommendationEventType(42)).toBe(false);
  });
});

describe('KAN-202 recommendation events — isRecommendationEventSource', () => {
  test('accepts web / mcp / email', () => {
    expect(isRecommendationEventSource('web')).toBe(true);
    expect(isRecommendationEventSource('mcp')).toBe(true);
    expect(isRecommendationEventSource('email')).toBe(true);
  });

  test('rejects others', () => {
    expect(isRecommendationEventSource('mobile')).toBe(false);
    expect(isRecommendationEventSource('')).toBe(false);
    expect(isRecommendationEventSource(null)).toBe(false);
  });
});

describe('KAN-202 recommendation events — sanitiseEventMetadata', () => {
  test('null / undefined / wrong shape → empty object', () => {
    expect(sanitiseEventMetadata(null)).toEqual({});
    expect(sanitiseEventMetadata(undefined)).toEqual({});
    expect(sanitiseEventMetadata('hello')).toEqual({});
    expect(sanitiseEventMetadata(42)).toEqual({});
    expect(sanitiseEventMetadata([])).toEqual({});
  });

  test('passes through scalar values', () => {
    const input = {
      position: 2,
      concept: 'books_reading',
      first_render: true,
      reason: 'too_expensive',
    };
    expect(sanitiseEventMetadata(input)).toEqual(input);
  });

  test('drops nested objects, arrays, null, undefined, functions', () => {
    const input = {
      ok: 'fine',
      nested: { not: 'allowed' },
      list: [1, 2, 3],
      nullish: null,
      missing: undefined,
      func: () => 'no',
    };
    expect(sanitiseEventMetadata(input)).toEqual({ ok: 'fine' });
  });

  test('caps string values at 200 chars', () => {
    const long = 'a'.repeat(500);
    const out = sanitiseEventMetadata({ blob: long });
    expect(out.blob).toBe('a'.repeat(200));
  });

  test('drops Infinity / NaN', () => {
    expect(sanitiseEventMetadata({ inf: Infinity, nan: NaN, ok: 1 })).toEqual({
      ok: 1,
    });
  });

  test('rejects prototype-pollution-style keys', () => {
    const input = {
      __proto__: { polluted: true },
      constructor: { also: 'bad' },
      prototype: { worse: true },
      ok: 'fine',
    };
    const out = sanitiseEventMetadata(input);
    expect(out).toEqual({ ok: 'fine' });
    // Confirm the prototype really isn't polluted.
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
  });

  test('rejects empty / overlong keys', () => {
    const longKey = 'k'.repeat(100);
    const out = sanitiseEventMetadata({ '': 'empty', [longKey]: 'long', ok: 1 });
    expect(out).toEqual({ ok: 1 });
  });

  test('produces a fresh object every call (no shared mutable state)', () => {
    const a = sanitiseEventMetadata({});
    const b = sanitiseEventMetadata({});
    expect(a).not.toBe(b);
    a.foo = 1;
    expect(b.foo).toBeUndefined();
  });

  test('real-world examples from the design doc', () => {
    expect(sanitiseEventMetadata({ position: 2, concept: 'books_reading' })).toEqual({
      position: 2,
      concept: 'books_reading',
    });
    expect(sanitiseEventMetadata({ reason: 'too_expensive' })).toEqual({
      reason: 'too_expensive',
    });
  });
});
