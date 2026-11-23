/**
 * KAN-487 — pure rules behind editor sections 02 (affiliations) and 03
 * (gifts AI slot). Spec v0.8 §02, §03; plan §C rows 02–03. Expected values
 * are literals from the spec / plan.
 */
import {
  AFFILIATION_GROUPS,
  SUGGEST_DEBOUNCE_MS,
  affiliationFieldSpec,
  approvedAiGifts,
  rowsOfType,
  shouldLookUpName,
  undoIndexInGroup,
  visibleNameOptions,
} from '@/modules/profile/editor/affiliation-gift-ui';
import type { AffRow, AffiliationType, AiGiftRow } from '@/modules/profile/editor/editor-state';

function aff(key: string, type: AffiliationType): AffRow {
  return { key, id: key, affiliationType: type, name: key, location: '', description: '', showOnProfile: false };
}

function ai(id: string, approved: boolean): AiGiftRow {
  return { id, title: id, description: '', url: '', approved };
}

describe('KAN-487 §02 groups', () => {
  test('three groups in spec order with spec add labels', () => {
    expect(AFFILIATION_GROUPS).toEqual([
      { type: 'school', heading: 'Schools', addLabel: 'Add school' },
      { type: 'organisation', heading: 'Organisations', addLabel: 'Add organisation' },
      { type: 'community', heading: 'Communities', addLabel: 'Add community' },
    ]);
  });
});

describe('KAN-487 §02 field limits', () => {
  test('school: name 120 required, postcode 12 required, description 250', () => {
    expect(affiliationFieldSpec('school')).toEqual({
      nameLabel: 'Name',
      nameMax: 120,
      locationLabel: 'Postcode',
      locationMax: 12,
      locationRequired: true,
      descriptionLabel: 'Description',
      descriptionMax: 250,
    });
  });

  test.each(['organisation', 'community'] as const)('%s: name 120, location 120 optional, description 250', (t) => {
    expect(affiliationFieldSpec(t)).toEqual({
      nameLabel: 'Name',
      nameMax: 120,
      locationLabel: 'Location',
      locationMax: 120,
      locationRequired: false,
      descriptionLabel: 'Description',
      descriptionMax: 250,
    });
  });
});

describe('KAN-487 §02 grouping and undo position', () => {
  const rows = [aff('s1', 'school'), aff('o1', 'organisation'), aff('s2', 'school'), aff('c1', 'community'), aff('s3', 'school')];

  test('rowsOfType keeps stored order and filters by type', () => {
    expect(rowsOfType(rows, 'school').map((r) => r.key)).toEqual(['s1', 's2', 's3']);
    expect(rowsOfType(rows, 'community').map((r) => r.key)).toEqual(['c1']);
  });

  test('a school removed from global index 2 (after s1, o1) goes back at group position 1', () => {
    // state after removing s2: [s1, o1, c1, s3]
    const after = [rows[0], rows[1], rows[3], rows[4]];
    expect(undoIndexInGroup(after, 2, 'school')).toBe(1);
  });

  test('removed first in the array → group position 0', () => {
    expect(undoIndexInGroup(rows.slice(1), 0, 'school')).toBe(0);
  });

  test('index past the end → after every row of the group', () => {
    expect(undoIndexInGroup(rows, 99, 'school')).toBe(3);
  });

  test('other types before the index are not counted', () => {
    expect(undoIndexInGroup(rows, 4, 'organisation')).toBe(1);
  });
});

describe('KAN-487 §02 name autocomplete', () => {
  test('debounce is 350 ms', () => {
    expect(SUGGEST_DEBOUNCE_MS).toBe(350);
  });

  test('no lookup under 3 characters', () => {
    expect(shouldLookUpName('St', null)).toBe(false);
  });

  test('3 characters looks up', () => {
    expect(shouldLookUpName('Sta', null)).toBe(true);
  });

  test('whitespace does not count towards 3', () => {
    expect(shouldLookUpName('  ab  ', null)).toBe(false);
  });

  test('no lookup for the name just picked or dismissed', () => {
    expect(shouldLookUpName('St Mary', 'St Mary')).toBe(false);
    expect(shouldLookUpName('St Mary’s', 'St Mary')).toBe(true);
  });

  test('matches then "add your own" with the typed text', () => {
    expect(visibleNameOptions('St M', { query: 'St M', names: ['St Mary School', 'St Mark Academy'] }, null)).toEqual([
      { kind: 'place', name: 'St Mary School', address: null, postcode: null },
      { kind: 'place', name: 'St Mark Academy', address: null, postcode: null },
      { kind: 'custom', name: 'St M' },
    ]);
  });

  test('a stale answer (for other text) is not shown', () => {
    expect(visibleNameOptions('St Ma', { query: 'St M', names: ['St Mary School'] }, null)).toEqual([]);
  });

  test('no matches → no list (manual fallback is the plain field)', () => {
    expect(visibleNameOptions('Zzz', { query: 'Zzz', names: [] }, null)).toEqual([]);
  });

  test('no answer yet → no list', () => {
    expect(visibleNameOptions('St M', null, null)).toEqual([]);
  });

  test('closed for this text (picked / Escape) → no list', () => {
    expect(visibleNameOptions('St M', { query: 'St M', names: ['St Mary School'] }, 'St M')).toEqual([]);
  });
});

describe('KAN-487 §03 AI slot shows approved suggestions only', () => {
  test('unapproved suggestions are dropped, order kept', () => {
    expect(approvedAiGifts([ai('a', true), ai('b', false), ai('c', true)]).map((g) => g.id)).toEqual(['a', 'c']);
  });

  test('none approved → empty (slot renders nothing visible)', () => {
    expect(approvedAiGifts([ai('a', false), ai('b', false)])).toEqual([]);
  });
});
