/**
 * KAN-487 — v0.8 editor reducer (plan §A "Pure logic", §F; spec v0.8 §01–§10).
 *
 * Behavioural: drives the real `editorReducer` from states built with the
 * real `initialEditorState`. Expected values are literals from the spec /
 * plan (caps 6/25/15/10), never derived from the module under test
 * (CLAUDE.md failure mode 10).
 */
import { editorReducer, saveBaselineFromResult, type EditorAction } from '@/modules/profile/editor/editor-reducer';
import { buildSavePayload, isDirty } from '@/modules/profile/editor/editor-diff';
import {
  initialEditorState,
  type EditorState,
  type LoadedProfile,
  type LoadedItem,
  type LoadedAnswer,
  type ListKey,
} from '@/modules/profile/editor/editor-state';

const PID = '00000000-0000-4000-8000-000000000001';

function item(id: string, category: LoadedItem['category'], title = `title ${id}`): LoadedItem {
  return { id, category, title, description: null, url: null, group_label: null, origin: 'user', approved: true };
}

function answer(over: Partial<LoadedAnswer> & Pick<LoadedAnswer, 'id'>): LoadedAnswer {
  return {
    prompt_id: null,
    answer: `answer ${over.id}`,
    prompt: '',
    custom_prompt: null,
    answer_max: null,
    ...over,
  };
}

function loaded(over: Partial<LoadedProfile> = {}, profileOver: Partial<LoadedProfile['profile']> = {}): LoadedProfile {
  return {
    profile: {
      id: PID,
      display_name: 'Ada',
      slug: 'ada_l',
      slug_confirmed: false,
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

function run(state: EditorState, ...actions: EditorAction[]): EditorState {
  return actions.reduce(editorReducer, state);
}

function ids(rows: ReadonlyArray<{ key: string }>): string[] {
  return rows.map((r) => r.key);
}

const causesState = (): EditorState =>
  initialEditorState(loaded({ items: [item('c1', 'causes'), item('c2', 'causes'), item('c3', 'causes')] }));

// ── Plain fields ────────────────────────────────────────────────────────

describe('setField / setManualOfMe / setLyraId', () => {
  test('setField writes one profile field', () => {
    const s = run(initialEditorState(loaded()), { type: 'setField', field: 'headline', value: 'Hello' });
    expect(s.fields.headline).toBe('Hello');
    expect(s.fields.display_name).toBe('Ada');
  });

  test('setManualOfMe writes one Manual of Me field', () => {
    const s = run(initialEditorState(loaded()), { type: 'setManualOfMe', field: 'good_to_know', value: "I'm a slow texter" });
    expect(s.manualOfMe.good_to_know).toBe("I'm a slow texter");
    expect(s.manualOfMe.boundaries).toBe('');
  });

  test('setLyraId changes the ID while unlocked', () => {
    const s = run(initialEditorState(loaded()), { type: 'setLyraId', value: 'ada_new' });
    expect(s.lyraId).toBe('ada_new');
  });

  test('setLyraId is ignored once first published (locked)', () => {
    const start = initialEditorState(
      loaded({}, { slug_confirmed: true, first_published_at: '2026-11-01T00:00:00.000Z' }),
    );
    const s = run(start, { type: 'setLyraId', value: 'other' });
    expect(s).toBe(start);
    expect(s.lyraId).toBe('ada_l');
  });

  test('the reducer does not mutate the input state', () => {
    const start = initialEditorState(loaded());
    const before = JSON.stringify(start);
    run(start, { type: 'setField', field: 'city', value: 'Leeds' }, { type: 'addRow', listKey: 'causes' });
    expect(JSON.stringify(start)).toBe(before);
  });
});

// ── Lists ───────────────────────────────────────────────────────────────

describe('addRow / updateRow', () => {
  test('addRow appends a blank new row with the given key and the list category', () => {
    const s = run(initialEditorState(loaded()), { type: 'addRow', listKey: 'fav_screen', key: 'new:k1' });
    expect(s.lists.fav_screen).toEqual([
      { key: 'new:k1', id: null, category: 'favourite_media', title: '', description: '', url: '' },
    ]);
  });

  test('addRow without a key generates a new: key', () => {
    const s = run(initialEditorState(loaded()), { type: 'addRow', listKey: 'causes' });
    expect(s.lists.causes).toHaveLength(1);
    expect(s.lists.causes[0].key.startsWith('new:')).toBe(true);
  });

  test('updateRow patches only the targeted row', () => {
    const s = run(causesState(), { type: 'updateRow', listKey: 'causes', key: 'c2', patch: { title: 'Rivers' } });
    expect(s.lists.causes.map((r) => r.title)).toEqual(['title c1', 'Rivers', 'title c3']);
    expect(s.lists.causes[1]).toMatchObject({ key: 'c2', id: 'c2', category: 'causes' });
  });

  test('updateRow with an unknown key returns the same state', () => {
    const start = causesState();
    expect(run(start, { type: 'updateRow', listKey: 'causes', key: 'nope', patch: { title: 'x' } })).toBe(start);
  });
});

describe('addRow section caps (spec literals)', () => {
  const CAPS: Array<[ListKey, number]> = [
    ['causes', 6],
    ['proud_of', 6],
    ['gift_ideas', 25],
    ['gifts_to_avoid', 15],
    ['fav_quotes', 15],
    ['fav_screen', 15],
    ['fav_books', 15],
    ['fav_places', 15],
    ['fav_others', 15],
    ['life_hacks', 15],
    ['current_problems', 10],
  ];

  test('corpus is non-empty', () => {
    expect(CAPS.length).toBe(11);
  });

  test.each(CAPS)('%s stops at %i rows', (listKey, cap) => {
    let s = initialEditorState(loaded());
    for (let i = 0; i < cap + 3; i++) s = editorReducer(s, { type: 'addRow', listKey });
    expect(s.lists[listKey]).toHaveLength(cap);
  });

  test('at the cap addRow returns the same state object', () => {
    let s = initialEditorState(loaded());
    for (let i = 0; i < 6; i++) s = editorReducer(s, { type: 'addRow', listKey: 'causes' });
    expect(s.lists.causes).toHaveLength(6);
    expect(editorReducer(s, { type: 'addRow', listKey: 'causes' })).toBe(s);
  });

  test('one below the cap a row is still added', () => {
    let s = initialEditorState(loaded());
    for (let i = 0; i < 5; i++) s = editorReducer(s, { type: 'addRow', listKey: 'causes' });
    expect(editorReducer(s, { type: 'addRow', listKey: 'causes' }).lists.causes).toHaveLength(6);
  });

  test('legacy-category rows in a list count toward its cap (fav_screen: plays + favourite_tv)', () => {
    const items: LoadedItem[] = [];
    for (let i = 0; i < 8; i++) items.push(item(`p${i}`, 'plays'));
    for (let i = 0; i < 7; i++) items.push(item(`t${i}`, 'favourite_tv'));
    const start = initialEditorState(loaded({ items }));
    expect(start.lists.fav_screen).toHaveLength(15);
    expect(editorReducer(start, { type: 'addRow', listKey: 'fav_screen' })).toBe(start);
  });
});

describe('removeRow / undoRemove', () => {
  test('remove takes the row out and records {listKey,row,index,at}', () => {
    const s = run(causesState(), { type: 'removeRow', listKey: 'causes', key: 'c2', at: 1234 });
    expect(ids(s.lists.causes)).toEqual(['c1', 'c3']);
    expect(s.undo.causes).toEqual({
      listKey: 'causes',
      index: 1,
      at: 1234,
      row: { key: 'c2', id: 'c2', category: 'causes', title: 'title c2', description: '', url: '', groupLabel: null },
    });
  });

  test.each([
    ['c1', ['c1', 'c2', 'c3']],
    ['c2', ['c1', 'c2', 'c3']],
    ['c3', ['c1', 'c2', 'c3']],
  ])('undo after removing %s restores the original order', (key, expected) => {
    const s = run(causesState(), { type: 'removeRow', listKey: 'causes', key }, { type: 'undoRemove', listKey: 'causes' });
    expect(ids(s.lists.causes)).toEqual(expected);
    expect(s.undo.causes).toBeUndefined();
  });

  test('undo index is clamped when the list shrank meanwhile', () => {
    const removed = run(causesState(), { type: 'removeRow', listKey: 'causes', key: 'c3' }); // index 2
    const shrunk: EditorState = { ...removed, lists: { ...removed.lists, causes: removed.lists.causes.slice(0, 1) } };
    const restored = editorReducer(shrunk, { type: 'undoRemove', listKey: 'causes' });
    expect(ids(restored.lists.causes)).toEqual(['c1', 'c3']);
  });

  test('a newer removal in the same list replaces the older undo; the older row stays removed', () => {
    const s = run(
      causesState(),
      { type: 'removeRow', listKey: 'causes', key: 'c1' },
      { type: 'removeRow', listKey: 'causes', key: 'c3' },
    );
    expect(s.undo.causes?.row.key).toBe('c3');
    const u = editorReducer(s, { type: 'undoRemove', listKey: 'causes' });
    expect(ids(u.lists.causes)).toEqual(['c2', 'c3']);
    // A second undo does nothing: c1 is gone for good.
    expect(editorReducer(u, { type: 'undoRemove', listKey: 'causes' })).toBe(u);
  });

  test('undo entries are per list: removing from another list keeps this one', () => {
    const start = initialEditorState(
      loaded({ items: [item('c1', 'causes'), item('c2', 'causes'), item('p1', 'proud_of')] }),
    );
    const s = run(
      start,
      { type: 'removeRow', listKey: 'causes', key: 'c1' },
      { type: 'removeRow', listKey: 'proud_of', key: 'p1' },
    );
    expect(s.undo.causes?.row.key).toBe('c1');
    expect(s.undo.proud_of?.row.key).toBe('p1');
    const u = editorReducer(s, { type: 'undoRemove', listKey: 'causes' });
    expect(ids(u.lists.causes)).toEqual(['c1', 'c2']);
    expect(u.lists.proud_of).toEqual([]);
    expect(u.undo.proud_of?.row.key).toBe('p1');
  });

  test('undo with nothing pending returns the same state', () => {
    const start = causesState();
    expect(editorReducer(start, { type: 'undoRemove', listKey: 'causes' })).toBe(start);
  });

  test('remove with an unknown key returns the same state and records no undo', () => {
    const start = causesState();
    expect(editorReducer(start, { type: 'removeRow', listKey: 'causes', key: 'nope' })).toBe(start);
  });

  test('a removed row restored by undo keeps edits made before removal', () => {
    const s = run(
      causesState(),
      { type: 'updateRow', listKey: 'causes', key: 'c2', patch: { title: 'Edited' } },
      { type: 'removeRow', listKey: 'causes', key: 'c2' },
      { type: 'undoRemove', listKey: 'causes' },
    );
    expect(s.lists.causes[1]).toMatchObject({ key: 'c2', title: 'Edited' });
  });
});

// ── Affiliations ────────────────────────────────────────────────────────

describe('affiliations', () => {
  const start = (): EditorState =>
    initialEditorState(
      loaded({
        schools: [
          { id: 's1', affiliation_type: 'school', school_name: 'A', school_location: 'LS1 1AA', description: null, show_on_profile: true },
          { id: 's2', affiliation_type: 'organisation', school_name: 'B', school_location: null, description: null, show_on_profile: false },
          { id: 's3', affiliation_type: 'community', school_name: 'C', school_location: null, description: null, show_on_profile: true },
        ],
      }),
    );

  test('addAffiliation appends a blank row of that type, unchecked by default (§02)', () => {
    const s = run(start(), { type: 'addAffiliation', affiliationType: 'community', key: 'new:a1' });
    expect(s.affiliations[3]).toEqual({
      key: 'new:a1',
      id: null,
      affiliationType: 'community',
      name: '',
      location: '',
      description: '',
      showOnProfile: false,
    });
  });

  test('updateAffiliation patches the targeted row', () => {
    const s = run(start(), { type: 'updateAffiliation', key: 's2', patch: { name: 'B2', showOnProfile: true } });
    expect(s.affiliations[1]).toMatchObject({ key: 's2', name: 'B2', showOnProfile: true, affiliationType: 'organisation' });
  });

  test('remove + undo restores at the original index', () => {
    const s = run(start(), { type: 'removeAffiliation', key: 's2', at: 5 });
    expect(ids(s.affiliations)).toEqual(['s1', 's3']);
    expect(s.undo.affiliations).toMatchObject({ listKey: 'affiliations', index: 1, at: 5 });
    const u = editorReducer(s, { type: 'undoRemove', listKey: 'affiliations' });
    expect(ids(u.affiliations)).toEqual(['s1', 's2', 's3']);
  });

  test('a newer affiliation removal replaces the older undo', () => {
    const s = run(
      start(),
      { type: 'removeAffiliation', key: 's1' },
      { type: 'removeAffiliation', key: 's3' },
      { type: 'undoRemove', listKey: 'affiliations' },
    );
    expect(ids(s.affiliations)).toEqual(['s2', 's3']);
  });
});

// ── Questions ───────────────────────────────────────────────────────────

describe('questions', () => {
  const start = (): EditorState =>
    initialEditorState(
      loaded({
        conversationPrompts: [
          { id: 'pr1', prompt: 'Best meal?', sort_order: 1, answer_max: 300 },
          { id: 'pr2', prompt: 'Dream trip?', sort_order: 2, answer_max: 400 },
          { id: 'pr3', prompt: 'Hidden talent?', sort_order: 3, answer_max: null },
        ],
        conversationAnswers: [
          answer({ id: 'qa1', prompt_id: 'pr1', prompt: 'Best meal?', answer: 'Pho' }),
          answer({ id: 'cq1', custom_prompt: 'Q1?', sort_order: 0 }),
          answer({ id: 'cq2', custom_prompt: 'Q2?', sort_order: 1 }),
          answer({ id: 'cq3', custom_prompt: 'Q3?', sort_order: 2 }),
        ],
      }),
    );

  const customs = (s: EditorState) =>
    s.questions.flatMap((q) => (q.kind === 'custom' ? [{ key: q.key, sortOrder: q.sortOrder }] : []));

  test('answerPreset updates an existing preset answer in place', () => {
    const s = run(start(), { type: 'answerPreset', promptId: 'pr1', text: 'Ramen' });
    expect(s.questions[0]).toMatchObject({ kind: 'preset', key: 'qa1', id: 'qa1', answer: 'Ramen' });
    expect(s.questions).toHaveLength(4);
  });

  test('answerPreset for an unanswered preset adds it after the preset answers, before custom questions', () => {
    const s = run(start(), { type: 'answerPreset', promptId: 'pr2', text: 'Peru', key: 'new:p2' });
    expect(ids(s.questions)).toEqual(['qa1', 'new:p2', 'cq1', 'cq2', 'cq3']);
    expect(s.questions[1]).toEqual({
      kind: 'preset',
      key: 'new:p2',
      id: null,
      promptId: 'pr2',
      prompt: 'Dream trip?',
      answerMax: 400,
      answer: 'Peru',
      isActive: true,
    });
  });

  test('answerPreset for an unknown prompt returns the same state', () => {
    const s0 = start();
    expect(editorReducer(s0, { type: 'answerPreset', promptId: 'zzz', text: 'x' })).toBe(s0);
  });

  test('addCustomQuestion appends with the next sort_order', () => {
    const s = run(start(), { type: 'addCustomQuestion', customPrompt: 'Q4?', answer: 'A4', key: 'new:c4' });
    expect(s.questions[4]).toEqual({
      kind: 'custom',
      key: 'new:c4',
      id: null,
      customPrompt: 'Q4?',
      answer: 'A4',
      sortOrder: 3,
      createdAt: null,
    });
  });

  test('updateQuestion edits a custom prompt + answer; a preset only its answer', () => {
    const s = run(
      start(),
      { type: 'updateQuestion', key: 'cq2', patch: { customPrompt: 'Q2 edited?', answer: 'new' } },
      { type: 'updateQuestion', key: 'qa1', patch: { answer: 'Tacos', customPrompt: 'ignored' } },
    );
    expect(s.questions[2]).toMatchObject({ kind: 'custom', customPrompt: 'Q2 edited?', answer: 'new' });
    expect(s.questions[0]).toMatchObject({ kind: 'preset', prompt: 'Best meal?', answer: 'Tacos' });
    expect(s.questions[0]).not.toHaveProperty('customPrompt');
  });

  test('removeQuestion + undo restores at the original index', () => {
    const s = run(start(), { type: 'removeQuestion', key: 'cq2', at: 9 });
    expect(ids(s.questions)).toEqual(['qa1', 'cq1', 'cq3']);
    expect(s.undo.questions).toMatchObject({ listKey: 'questions', index: 2, at: 9 });
    const u = editorReducer(s, { type: 'undoRemove', listKey: 'questions' });
    expect(ids(u.questions)).toEqual(['qa1', 'cq1', 'cq2', 'cq3']);
  });

  test('moveCustomQuestion down swaps with the next custom and renumbers 0..n-1', () => {
    const s = run(start(), { type: 'moveCustomQuestion', key: 'cq1', direction: 1 });
    expect(customs(s)).toEqual([
      { key: 'cq2', sortOrder: 0 },
      { key: 'cq1', sortOrder: 1 },
      { key: 'cq3', sortOrder: 2 },
    ]);
  });

  test('moveCustomQuestion up swaps with the previous custom', () => {
    const s = run(start(), { type: 'moveCustomQuestion', key: 'cq3', direction: -1 });
    expect(customs(s)).toEqual([
      { key: 'cq1', sortOrder: 0 },
      { key: 'cq3', sortOrder: 1 },
      { key: 'cq2', sortOrder: 2 },
    ]);
  });

  test('moving the first custom up is a no-op (never moves above a preset)', () => {
    const s0 = start();
    const s = editorReducer(s0, { type: 'moveCustomQuestion', key: 'cq1', direction: -1 });
    expect(s).toBe(s0);
    expect(ids(s.questions)).toEqual(['qa1', 'cq1', 'cq2', 'cq3']);
  });

  test('moving the last custom down is a no-op', () => {
    const s0 = start();
    expect(editorReducer(s0, { type: 'moveCustomQuestion', key: 'cq3', direction: 1 })).toBe(s0);
  });

  test('a preset key cannot be moved', () => {
    const s0 = start();
    expect(editorReducer(s0, { type: 'moveCustomQuestion', key: 'qa1', direction: 1 })).toBe(s0);
  });

  test('presets keep their positions when customs move', () => {
    const s = run(
      start(),
      { type: 'answerPreset', promptId: 'pr2', text: 'Peru', key: 'new:p2' },
      { type: 'moveCustomQuestion', key: 'cq2', direction: -1 },
      { type: 'moveCustomQuestion', key: 'cq3', direction: -1 },
    );
    expect(ids(s.questions)).toEqual(['qa1', 'new:p2', 'cq2', 'cq3', 'cq1']);
    expect(customs(s).map((c) => c.sortOrder)).toEqual([0, 1, 2]);
  });
});

// ── Photo / AI gifts ────────────────────────────────────────────────────

describe('photo', () => {
  test('setPhoto stores the given photo state', () => {
    const s = run(initialEditorState(loaded()), {
      type: 'setPhoto',
      photo: { kind: 'staged', path: 'u/avatar-1.jpg', previewUrl: 'blob:x' },
    });
    expect(s.photo).toEqual({ kind: 'staged', path: 'u/avatar-1.jpg', previewUrl: 'blob:x' });
  });

  test('requestPhotoRemoval marks a stored photo removed', () => {
    const s = run(initialEditorState(loaded({}, { avatar_url: 'https://x/a.jpg' })), { type: 'requestPhotoRemoval' });
    expect(s.photo).toEqual({ kind: 'removed' });
  });

  test('requestPhotoRemoval with no photo returns the same state', () => {
    const s0 = initialEditorState(loaded());
    expect(editorReducer(s0, { type: 'requestPhotoRemoval' })).toBe(s0);
  });
});

describe('AI gifts (step-6 hooks)', () => {
  const start = (): EditorState =>
    initialEditorState(
      loaded({
        items: [
          { ...item('a1', 'gift_ideas'), origin: 'ai', approved: false },
          { ...item('a2', 'gift_ideas'), origin: 'ai', approved: false },
        ],
      }),
    );

  test('approveAiGift approves only that gift', () => {
    const s = run(start(), { type: 'approveAiGift', id: 'a2' });
    expect(s.aiGifts.map((g) => [g.id, g.approved])).toEqual([
      ['a1', false],
      ['a2', true],
    ]);
  });

  test('deleteAiGift removes only that gift and never touches gift_ideas', () => {
    const s0 = start();
    const s = run(s0, { type: 'deleteAiGift', id: 'a1' });
    expect(s.aiGifts.map((g) => g.id)).toEqual(['a2']);
    expect(s.lists.gift_ideas).toBe(s0.lists.gift_ideas);
  });
});

// ── applySaveResult ─────────────────────────────────────────────────────

describe('applySaveResult', () => {
  test('rewrites new: keys to DB ids across lists, affiliations and questions', () => {
    const s = run(
      initialEditorState(
        loaded({
          items: [item('c1', 'causes')],
          conversationPrompts: [{ id: 'pr1', prompt: 'Best meal?', sort_order: 1, answer_max: 300 }],
        }),
      ),
      { type: 'addRow', listKey: 'causes', key: 'new:r1' },
      { type: 'updateRow', listKey: 'causes', key: 'new:r1', patch: { title: 'Bees' } },
      { type: 'addAffiliation', affiliationType: 'school', key: 'new:a1' },
      { type: 'answerPreset', promptId: 'pr1', text: 'Pho', key: 'new:q1' },
      { type: 'addCustomQuestion', customPrompt: 'Why?', key: 'new:q2' },
      {
        type: 'applySaveResult',
        idMap: {
          'new:r1': '11111111-1111-4111-8111-111111111111',
          'new:a1': '22222222-2222-4222-8222-222222222222',
          'new:q1': '33333333-3333-4333-8333-333333333333',
          'new:q2': '44444444-4444-4444-8444-444444444444',
        },
        newBaseline: { updatedAt: '2026-11-23T11:00:00.000Z' },
      },
    );
    expect(s.lists.causes.map((r) => [r.key, r.id, r.title])).toEqual([
      ['c1', 'c1', 'title c1'],
      ['11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Bees'],
    ]);
    expect(s.affiliations.map((r) => [r.key, r.id])).toEqual([
      ['22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222'],
    ]);
    expect(s.questions.map((q) => [q.key, q.id])).toEqual([
      ['33333333-3333-4333-8333-333333333333', '33333333-3333-4333-8333-333333333333'],
      ['44444444-4444-4444-8444-444444444444', '44444444-4444-4444-8444-444444444444'],
    ]);
    expect(s.baseUpdatedAt).toBe('2026-11-23T11:00:00.000Z');
  });

  test('new rows missing from idMap (blank, not sent) keep their new: key', () => {
    const start = initialEditorState(loaded());
    const blankKey = start.lists.gift_ideas[0].key;
    const s = run(start, { type: 'applySaveResult', idMap: {}, newBaseline: { updatedAt: '2026-11-23T11:00:00.000Z' } });
    expect(s.lists.gift_ideas[0]).toMatchObject({ key: blankKey, id: null });
  });

  test('clears pending undos (the removals are now committed)', () => {
    const s = run(
      causesState(),
      { type: 'removeRow', listKey: 'causes', key: 'c1' },
      { type: 'applySaveResult', idMap: {}, newBaseline: { updatedAt: '2026-11-23T11:00:00.000Z' } },
    );
    expect(s.undo).toEqual({});
    expect(ids(s.lists.causes)).toEqual(['c2', 'c3']);
  });

  test('after first publish: published, ID locked, stored avatar', () => {
    const s = run(
      initialEditorState(loaded()),
      { type: 'setPhoto', photo: { kind: 'staged', path: 'u/avatar-1.jpg', previewUrl: 'blob:x' } },
      {
        type: 'applySaveResult',
        idMap: {},
        newBaseline: {
          updatedAt: '2026-11-23T11:00:00.000Z',
          isPublished: true,
          firstPublishedAt: '2026-11-23T11:00:00.000Z',
          avatarUrl: 'https://cdn/u/avatar-1.jpg',
        },
      },
    );
    expect(s.isPublished).toBe(true);
    expect(s.firstPublishedAt).toBe('2026-11-23T11:00:00.000Z');
    expect(s.lyraIdLocked).toBe(true);
    expect(s.photo).toEqual({ kind: 'stored', url: 'https://cdn/u/avatar-1.jpg' });
  });
});

// ── KAN-487 review M4: a refused CheckLyra ID never becomes the baseline ──

describe('review M4: refused CheckLyra ID stays dirty and is re-sent', () => {
  const SAVED = '2026-11-23T11:00:00.000Z';

  test('stored "alice1" (confirmed) → member types "bob" (taken) → draft → publish still sends "bob"', () => {
    const baseline = initialEditorState(loaded({}, { slug: 'alice1', slug_confirmed: true }));
    expect(baseline.lyraId).toBe('alice1');
    const sent = run(baseline, { type: 'setLyraId', value: 'bob' });
    expect(buildSavePayload(baseline, sent, 'draft').profile).toEqual({ slug: 'bob' });

    // Server: 'bob' is taken; the stored ID is still 'alice1'.
    const result = {
      ok: true as const,
      idMap: {},
      updatedAt: SAVED,
      warnings: { lyra_id: 'taken' },
      slug: 'alice1',
      slugConfirmed: true,
      avatarUrl: null,
      isPublished: false,
      firstPublishedAt: null,
    };
    const newBaseline = run(sent, { type: 'applySaveResult', idMap: result.idMap, newBaseline: saveBaselineFromResult(result) });
    expect(newBaseline.lyraId).toBe('alice1');

    const live = sent; // the editor still shows 'bob'
    expect(isDirty(newBaseline, live)).toBe(true);
    expect(buildSavePayload(newBaseline, live, 'publish').profile).toEqual({ slug: 'bob' });
  });

  test('no earlier confirmed ID: the baseline ID is empty, so the typed ID is re-sent on publish', () => {
    const baseline = initialEditorState(loaded({}, { slug: 'user_ab12cd', slug_confirmed: false }));
    expect(baseline.lyraId).toBe('');
    const sent = run(baseline, { type: 'setLyraId', value: 'bob' });
    const newBaseline = run(sent, {
      type: 'applySaveResult',
      idMap: {},
      newBaseline: { updatedAt: SAVED, warnings: { lyra_id: 'taken' }, slug: 'user_ab12cd', slugConfirmed: false },
    });
    expect(newBaseline.lyraId).toBe('');
    expect(buildSavePayload(newBaseline, sent, 'publish').profile).toEqual({ slug: 'bob' });
  });

  test('an accepted ID (no warning) becomes the baseline and is not re-sent', () => {
    const baseline = initialEditorState(loaded({}, { slug: 'alice1', slug_confirmed: true }));
    const sent = run(baseline, { type: 'setLyraId', value: 'bob' });
    const newBaseline = run(sent, {
      type: 'applySaveResult',
      idMap: {},
      newBaseline: { updatedAt: SAVED, warnings: {}, slug: 'bob', slugConfirmed: true },
    });
    expect(newBaseline.lyraId).toBe('bob');
    expect(isDirty(newBaseline, sent)).toBe(false);
  });

  test('saveBaselineFromResult carries every stored field the reducer needs', () => {
    expect(
      saveBaselineFromResult({
        ok: true,
        idMap: { a: 'b' },
        updatedAt: SAVED,
        warnings: { lyra_id: 'taken' },
        slug: 'alice1',
        slugConfirmed: true,
        avatarUrl: 'https://cdn/u/avatar-1.jpg',
        isPublished: true,
        firstPublishedAt: SAVED,
      }),
    ).toEqual({
      updatedAt: SAVED,
      isPublished: true,
      firstPublishedAt: SAVED,
      avatarUrl: 'https://cdn/u/avatar-1.jpg',
      slug: 'alice1',
      slugConfirmed: true,
      warnings: { lyra_id: 'taken' },
    });
  });
});
