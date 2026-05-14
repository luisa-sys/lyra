/**
 * KAN-143 — Per-item visibility filter unit tests.
 *
 * Covers the pure helpers in src/app/dashboard/profile/visibility.ts that
 * decide whether a profile_item is visible to a given viewer. These functions
 * are the single source of truth for visibility in application code — RLS
 * gives us defence in depth, but the page-level filter is what the public
 * profile actually relies on.
 *
 * Threats this test exists to catch:
 *   - Draft / private items leaking to anonymous viewers
 *   - members_only items leaking to anonymous viewers
 *   - A new visibility level being added without a corresponding filter
 *     decision (the fail-closed default catches this)
 *   - Default visibility silently changing away from 'public'
 */

import {
  VISIBILITY_LEVELS,
  DEFAULT_VISIBILITY,
  isAllowedVisibility,
  coerceVisibility,
  isItemVisibleToViewer,
  filterItemsByVisibility,
} from '@/app/dashboard/profile/visibility';

describe('VISIBILITY_LEVELS constant', () => {
  test('contains exactly the three documented levels', () => {
    expect([...VISIBILITY_LEVELS].sort()).toEqual(
      ['draft', 'members_only', 'public'].sort(),
    );
  });

  test('default visibility is "public" (no behaviour change for existing rows)', () => {
    expect(DEFAULT_VISIBILITY).toBe('public');
  });
});

describe('isAllowedVisibility', () => {
  test.each([
    ['public', true],
    ['members_only', true],
    ['draft', true],
    ['private', false], // legacy enum value — NOT a valid write target
    ['', false],
    ['PUBLIC', false], // case-sensitive
    ['anything-else', false],
  ])('isAllowedVisibility(%p) → %p', (input, expected) => {
    expect(isAllowedVisibility(input)).toBe(expected);
  });

  test('rejects non-string inputs', () => {
    expect(isAllowedVisibility(null)).toBe(false);
    expect(isAllowedVisibility(undefined)).toBe(false);
    expect(isAllowedVisibility(123)).toBe(false);
    expect(isAllowedVisibility({})).toBe(false);
    expect(isAllowedVisibility([])).toBe(false);
  });
});

describe('coerceVisibility', () => {
  test('passes valid levels through unchanged', () => {
    expect(coerceVisibility('public')).toBe('public');
    expect(coerceVisibility('members_only')).toBe('members_only');
    expect(coerceVisibility('draft')).toBe('draft');
  });

  test('falls back to "public" for invalid input (fail-open default)', () => {
    expect(coerceVisibility('garbage')).toBe('public');
    expect(coerceVisibility(undefined)).toBe('public');
    expect(coerceVisibility(null)).toBe('public');
    expect(coerceVisibility('')).toBe('public');
  });

  test('coerces the legacy "private" value to "public" — new writes should use "draft"', () => {
    // 'private' is no longer an accepted write target — the wizard UI no
    // longer offers it. If a malicious client sends it, fall back to the
    // safe default rather than silently letting it through.
    expect(coerceVisibility('private')).toBe('public');
  });
});

describe('isItemVisibleToViewer — anonymous viewer', () => {
  test('public items are visible', () => {
    expect(isItemVisibleToViewer('public', false)).toBe(true);
  });

  test('members_only items are HIDDEN', () => {
    expect(isItemVisibleToViewer('members_only', false)).toBe(false);
  });

  test('draft items are HIDDEN', () => {
    expect(isItemVisibleToViewer('draft', false)).toBe(false);
  });

  test('legacy "private" items are HIDDEN (treated as draft)', () => {
    expect(isItemVisibleToViewer('private', false)).toBe(false);
  });

  test('unknown / null / undefined visibility is HIDDEN (fail closed)', () => {
    expect(isItemVisibleToViewer('garbage', false)).toBe(false);
    expect(isItemVisibleToViewer(null, false)).toBe(false);
    expect(isItemVisibleToViewer(undefined, false)).toBe(false);
    expect(isItemVisibleToViewer('', false)).toBe(false);
  });
});

describe('isItemVisibleToViewer — authenticated viewer', () => {
  test('public items are visible', () => {
    expect(isItemVisibleToViewer('public', true)).toBe(true);
  });

  test('members_only items ARE visible', () => {
    expect(isItemVisibleToViewer('members_only', true)).toBe(true);
  });

  test('draft items are STILL HIDDEN (owner-only — RLS handles owner access separately)', () => {
    // The shared filter does NOT know who owns the item. Owner access is
    // handled by the dashboard route (which reads via the owner's session)
    // and by the existing "Users can manage own profile items" RLS policy.
    // Anywhere this filter runs, drafts must be invisible regardless of
    // auth state.
    expect(isItemVisibleToViewer('draft', true)).toBe(false);
    expect(isItemVisibleToViewer('private', true)).toBe(false);
  });
});

describe('filterItemsByVisibility', () => {
  const items = [
    { id: '1', title: 'Likes coffee', visibility: 'public' },
    { id: '2', title: 'Members nickname', visibility: 'members_only' },
    { id: '3', title: 'Secret note', visibility: 'draft' },
    { id: '4', title: 'Old legacy item', visibility: 'private' },
    { id: '5', title: 'Bare row', visibility: undefined },
    { id: '6', title: 'Tampered row', visibility: 'public-ish' },
  ];

  test('anonymous viewer sees ONLY public items', () => {
    const result = filterItemsByVisibility(items, false);
    expect(result.map((i) => i.id)).toEqual(['1']);
  });

  test('authenticated viewer sees public + members_only items', () => {
    const result = filterItemsByVisibility(items, true);
    expect(result.map((i) => i.id)).toEqual(['1', '2']);
  });

  test('preserves input order (stable filter)', () => {
    const ordered = [
      { id: 'b', visibility: 'public' },
      { id: 'a', visibility: 'public' },
      { id: 'c', visibility: 'public' },
    ];
    expect(filterItemsByVisibility(ordered, false).map((i) => i.id)).toEqual([
      'b',
      'a',
      'c',
    ]);
  });

  test('empty input returns empty output', () => {
    expect(filterItemsByVisibility([], false)).toEqual([]);
    expect(filterItemsByVisibility([], true)).toEqual([]);
  });

  test('never leaks an unrecognised visibility string to anonymous viewers', () => {
    // Regression: if someone adds a new visibility value to the schema and
    // forgets to update isItemVisibleToViewer, the new value MUST fail closed.
    const future = [{ id: 'f', visibility: 'future-public-tier' }];
    expect(filterItemsByVisibility(future, false)).toEqual([]);
    expect(filterItemsByVisibility(future, true)).toEqual([]);
  });
});
