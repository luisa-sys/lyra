/**
 * KAN-487 — v0.8 editor initial state (plan §A, spec v0.8 §01–§10).
 *
 * Behavioural: builds state from loader-shaped fixtures through the real
 * `initialEditorState`. Expected values are literals from the spec / plan,
 * never derived from the module under test (CLAUDE.md failure mode 10).
 */
import {
  initialEditorState,
  newRowKey,
  isNewRowKey,
  listKeyForCategory,
  LIST_CATEGORIES,
  type LoadedProfile,
  type LoadedItem,
  type ListKey,
} from '@/modules/profile/editor/editor-state';

const PID = '00000000-0000-4000-8000-000000000001';

function item(over: Partial<LoadedItem> & Pick<LoadedItem, 'id' | 'category'>): LoadedItem {
  return {
    title: `title ${over.id}`,
    description: null,
    url: null,
    group_label: null,
    origin: 'user',
    approved: true,
    ...over,
  };
}

function loaded(over: Partial<LoadedProfile> = {}, profileOver: Partial<LoadedProfile['profile']> = {}): LoadedProfile {
  return {
    profile: {
      id: PID,
      display_name: 'Ada',
      slug: 'ada_l',
      slug_confirmed: true,
      first_published_at: null,
      is_published: false,
      avatar_url: null,
      headline: null,
      city: null,
      country: null,
      bio_short: null,
      gift_voucher_hint: null,
      billboard: null,
      updated_at: '2026-11-23T10:00:00.000Z',
      ...profileOver,
    },
    items: [],
    schools: [],
    manualOfMe: null,
    conversationPrompts: [],
    conversationAnswers: [],
    ...over,
  };
}

describe('AI gift rows', () => {
  const s = initialEditorState(
    loaded({
      items: [
        item({ id: 'u1', category: 'gift_ideas', title: 'Tea' }),
        item({ id: 'a1', category: 'gift_ideas', origin: 'ai', approved: false, title: 'AI pick' }),
        item({ id: 'a2', category: 'gift_ideas', origin: 'ai', approved: true, title: 'AI ok' }),
      ],
    }),
  );

  test('go to aiGifts, never into gift_ideas', () => {
    expect(s.lists.gift_ideas.map((r) => r.id)).toEqual(['u1']);
    expect(s.aiGifts).toEqual([
      { id: 'a1', title: 'AI pick', description: '', url: '', approved: false },
      { id: 'a2', title: 'AI ok', description: '', url: '', approved: true },
    ]);
  });

  test('member rows never go to aiGifts', () => {
    expect(s.aiGifts.map((r) => r.id)).not.toContain('u1');
  });

  test('only AI gifts present: gift list still gets its one empty row', () => {
    const only = initialEditorState(
      loaded({ items: [item({ id: 'a1', category: 'gift_ideas', origin: 'ai', approved: false })] }),
    );
    expect(only.aiGifts).toHaveLength(1);
    expect(only.lists.gift_ideas).toHaveLength(1);
    expect(only.lists.gift_ideas[0].id).toBeNull();
  });
});

describe('initial blank rows', () => {
  test('no gifts: exactly one empty gift row (§03)', () => {
    const s = initialEditorState(loaded());
    expect(s.lists.gift_ideas).toHaveLength(1);
    const [row] = s.lists.gift_ideas;
    expect(row).toMatchObject({ id: null, category: 'gift_ideas', title: '', description: '', url: '' });
    expect(row.key.startsWith('new:')).toBe(true);
  });

  test('no not-for-me rows: exactly three blank rows (§04)', () => {
    const s = initialEditorState(loaded());
    expect(s.lists.gifts_to_avoid).toHaveLength(3);
    for (const row of s.lists.gifts_to_avoid) {
      expect(row).toMatchObject({ id: null, category: 'gifts_to_avoid', title: '', description: '', url: '' });
    }
    expect(new Set(s.lists.gifts_to_avoid.map((r) => r.key)).size).toBe(3);
  });

  test('existing rows: no blanks added', () => {
    const s = initialEditorState(
      loaded({
        items: [item({ id: 'g1', category: 'gift_ideas' }), item({ id: 'n1', category: 'gifts_to_avoid' })],
      }),
    );
    expect(s.lists.gift_ideas.map((r) => r.id)).toEqual(['g1']);
    expect(s.lists.gifts_to_avoid.map((r) => r.id)).toEqual(['n1']);
  });

  test('a legacy dislikes row does not count as a not-for-me row', () => {
    const s = initialEditorState(loaded({ items: [item({ id: 'd1', category: 'dislikes' })] }));
    expect(s.lists.gifts_to_avoid).toHaveLength(3);
    expect(s.lists.gifts_to_avoid.every((r) => r.id === null)).toBe(true);
  });

  test('every other list starts empty', () => {
    const s = initialEditorState(loaded());
    const others: ListKey[] = [
      'causes', 'proud_of', 'fav_quotes', 'fav_screen', 'fav_books',
      'fav_places', 'fav_others', 'life_hacks', 'current_problems',
    ];
    for (const k of others) expect(s.lists[k]).toEqual([]);
  });
});

describe('legacy categories', () => {
  const LEGACY = [
    'likes', 'dislikes', 'helpful_to_know', 'boundaries', 'questions', 'billboard',
    'dietary', 'mobility', 'transport', 'availability_pattern', 'allergies',
  ] as const;

  test('corpus is non-empty', () => {
    expect(LEGACY.length).toBe(11);
  });

  test.each(LEGACY)('%s is excluded from every list', (category) => {
    const s = initialEditorState(loaded({ items: [item({ id: 'legacy1', category })] }));
    const ids = Object.values(s.lists).flat().map((r) => r.id);
    expect(ids).not.toContain('legacy1');
    expect(s.aiGifts).toEqual([]);
    expect(listKeyForCategory(category)).toBeNull();
  });
});

describe('category → list mapping (spec §06 groups)', () => {
  const CASES: ReadonlyArray<readonly [string, ListKey]> = [
    ['causes', 'causes'],
    ['proud_of', 'proud_of'],
    ['gift_ideas', 'gift_ideas'],
    ['gifts_to_avoid', 'gifts_to_avoid'],
    ['quotes', 'fav_quotes'],
    ['favourite_media', 'fav_screen'],
    ['plays', 'fav_screen'],
    ['favourite_tv', 'fav_screen'],
    ['favourite_books', 'fav_books'],
    ['favourite_places', 'fav_places'],
    ['favourite_venues', 'fav_places'],
    ['favourite_custom', 'fav_others'],
    ['favourite_music', 'fav_others'],
    ['life_hacks', 'life_hacks'],
    ['current_problems', 'current_problems'],
  ];

  test('corpus is non-empty', () => {
    expect(CASES.length).toBe(15);
  });

  test.each(CASES)('stored %s rows show in %s', (category, listKey) => {
    const s = initialEditorState(
      loaded({ items: [item({ id: 'x1', category: category as LoadedItem['category'], group_label: 'Board games' })] }),
    );
    expect(s.lists[listKey].map((r) => r.id)).toContain('x1');
    expect(s.lists[listKey].find((r) => r.id === 'x1')).toMatchObject({
      key: 'x1',
      category,
      groupLabel: 'Board games',
    });
  });

  test('new rows get the primary category of their list', () => {
    expect(LIST_CATEGORIES.fav_screen.newCategory).toBe('favourite_media');
    expect(LIST_CATEGORIES.fav_places.newCategory).toBe('favourite_places');
    expect(LIST_CATEGORIES.fav_others.newCategory).toBe('favourite_custom');
    expect(LIST_CATEGORIES.fav_quotes.newCategory).toBe('quotes');
  });

  test('stored rows keep loader order and map nulls to empty strings', () => {
    const s = initialEditorState(
      loaded({
        items: [
          item({ id: 'b', category: 'life_hacks', description: 'desc', url: 'https://example.com' }),
          item({ id: 'a', category: 'life_hacks' }),
        ],
      }),
    );
    expect(s.lists.life_hacks).toEqual([
      { key: 'b', id: 'b', category: 'life_hacks', title: 'title b', description: 'desc', url: 'https://example.com', groupLabel: null },
      { key: 'a', id: 'a', category: 'life_hacks', title: 'title a', description: '', url: '', groupLabel: null },
    ]);
  });
});

describe('CheckLyra ID', () => {
  test('blank while slug_confirmed is false (signup placeholder)', () => {
    const s = initialEditorState(loaded({}, { slug: 'user_0123456789', slug_confirmed: false }));
    expect(s.lyraId).toBe('');
  });

  test('shown once slug_confirmed is true', () => {
    const s = initialEditorState(loaded({}, { slug: 'ada_l', slug_confirmed: true }));
    expect(s.lyraId).toBe('ada_l');
  });

  test('locked once first published', () => {
    expect(initialEditorState(loaded()).lyraIdLocked).toBe(false);
    const pub = initialEditorState(
      loaded({}, { first_published_at: '2026-11-01T00:00:00.000Z', is_published: true }),
    );
    expect(pub.lyraIdLocked).toBe(true);
    expect(pub.isPublished).toBe(true);
  });
});

describe('profile fields, photo, manual of me', () => {
  test('nulls become empty strings; values kept', () => {
    const s = initialEditorState(loaded({}, { headline: 'Hi', country: 'GB', billboard: 'line1\nline2' }));
    expect(s.fields).toEqual({
      display_name: 'Ada',
      headline: 'Hi',
      city: '',
      country: 'GB',
      bio_short: '',
      gift_voucher_hint: '',
      billboard: 'line1\nline2',
    });
    expect(s.baseUpdatedAt).toBe('2026-11-23T10:00:00.000Z');
  });

  test('photo: stored when avatar_url set, none otherwise', () => {
    expect(initialEditorState(loaded()).photo).toEqual({ kind: 'none' });
    expect(initialEditorState(loaded({}, { avatar_url: 'https://x/a.jpg' })).photo).toEqual({
      kind: 'stored',
      url: 'https://x/a.jpg',
    });
  });

  test('manual of me: all six fields, null → empty string', () => {
    const s = initialEditorState(
      loaded({
        manualOfMe: {
          communication_style: null,
          working_preferences: 'house',
          energises_me: null,
          drains_me: null,
          good_to_know: 'slow texter',
          boundaries: null,
        },
      }),
    );
    expect(s.manualOfMe).toEqual({
      communication_style: '',
      working_preferences: 'house',
      energises_me: '',
      drains_me: '',
      good_to_know: 'slow texter',
      boundaries: '',
    });
    expect(initialEditorState(loaded()).manualOfMe.good_to_know).toBe('');
  });

  test('affiliations mapped with show_on_profile kept', () => {
    const s = initialEditorState(
      loaded({
        schools: [
          { id: 's1', affiliation_type: 'school', school_name: 'Hill', school_location: 'AB1 2CD', description: null, show_on_profile: false },
          { id: 'o1', affiliation_type: 'organisation', school_name: 'Acme', school_location: null, description: 'eng', show_on_profile: true },
        ],
      }),
    );
    expect(s.affiliations).toEqual([
      { key: 's1', id: 's1', affiliationType: 'school', name: 'Hill', location: 'AB1 2CD', description: '', showOnProfile: false },
      { key: 'o1', id: 'o1', affiliationType: 'organisation', name: 'Acme', location: '', description: 'eng', showOnProfile: true },
    ]);
  });
});

describe('questions', () => {
  const s = initialEditorState(
    loaded({
      conversationPrompts: [
        { id: 'p2', prompt: 'Second?', sort_order: 2, answer_max: 300 },
        { id: 'p1', prompt: 'First?', sort_order: 1, answer_max: 500 },
      ],
      conversationAnswers: [
        { id: 'ans-old', prompt_id: 'p-gone', answer: 'kept', prompt: 'Retired prompt?', custom_prompt: null, answer_max: 250 },
        { id: 'ans1', prompt_id: 'p1', answer: 'yes', prompt: 'First?', custom_prompt: null, answer_max: 500 },
        { id: 'c-late', prompt_id: null, answer: 'a', prompt: 'Q late', custom_prompt: 'Q late', answer_max: null, sort_order: 1, created_at: '2026-01-01T00:00:00Z' },
        { id: 'c-null', prompt_id: null, answer: 'b', prompt: 'Q null', custom_prompt: 'Q null', answer_max: null, sort_order: null, created_at: '2025-01-01T00:00:00Z' },
        { id: 'c-early', prompt_id: null, answer: 'c', prompt: 'Q early', custom_prompt: 'Q early', answer_max: null, sort_order: 1, created_at: '2025-06-01T00:00:00Z' },
        { id: 'c-zero', prompt_id: null, answer: 'd', prompt: 'Q zero', custom_prompt: 'Q zero', answer_max: null, sort_order: 0, created_at: '2026-06-01T00:00:00Z' },
      ],
    }),
  );

  test('answers to deactivated presets are kept, marked inactive', () => {
    const old = s.questions.find((q) => q.id === 'ans-old');
    expect(old).toEqual({
      kind: 'preset', key: 'ans-old', id: 'ans-old', promptId: 'p-gone',
      prompt: 'Retired prompt?', answerMax: 250, answer: 'kept', isActive: false,
    });
    const active = s.questions.find((q) => q.id === 'ans1');
    expect(active).toMatchObject({ kind: 'preset', isActive: true, answerMax: 500 });
  });

  test('custom questions sorted by sort_order then created_at (nulls last)', () => {
    const custom = s.questions.filter((q) => q.kind === 'custom').map((q) => q.id);
    expect(custom).toEqual(['c-zero', 'c-early', 'c-late', 'c-null']);
  });

  test('presets listed in sort_order with their answer_max', () => {
    expect(s.presets).toEqual([
      { id: 'p1', prompt: 'First?', answerMax: 500, sortOrder: 1 },
      { id: 'p2', prompt: 'Second?', answerMax: 300, sortOrder: 2 },
    ]);
  });

  test('undo starts empty', () => {
    expect(s.undo).toEqual({});
  });
});

describe('newRowKey', () => {
  test("'new:' + a UUID, unique per call", () => {
    const a = newRowKey();
    const b = newRowKey();
    expect(a).toMatch(/^new:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
    expect(isNewRowKey(a)).toBe(true);
    expect(isNewRowKey('3f1c0e1a-0000-4000-8000-000000000000')).toBe(false);
  });
});
