/**
 * KAN-487 — v0.8 editor save DIFF and dirty check (plan §A `editor-diff.ts`,
 * plan §B "Payload"; BUGS-74 regression).
 *
 * Behavioural: baselines are built through the real `initialEditorState`,
 * edited copies are compared through the real `buildSavePayload` / `isDirty`.
 * Expected payloads are literals (CLAUDE.md failure mode 10).
 */
import { buildSavePayload, isDirty } from '@/modules/profile/editor/editor-diff';
import {
  initialEditorState,
  type EditorState,
  type LoadedItem,
  type LoadedProfile,
} from '@/modules/profile/editor/editor-state';

const PID = '00000000-0000-4000-8000-000000000001';
const BASE_AT = '2026-11-23T10:00:00.000Z';

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

function loaded(profileOver: Partial<LoadedProfile['profile']> = {}): LoadedProfile {
  return {
    profile: {
      id: PID,
      display_name: 'Ada',
      slug: 'ada_l',
      slug_confirmed: true,
      first_published_at: null,
      is_published: false,
      avatar_url: 'https://cdn.example/ada/avatar-1.jpg',
      headline: 'Engineer',
      city: 'London',
      country: 'GB',
      bio_short: null,
      gift_voucher_hint: null,
      billboard: null,
      updated_at: BASE_AT,
      ...profileOver,
    },
    items: [
      item({ id: 'i-cause', category: 'causes', title: 'Clean rivers' }),
      item({ id: 'i-gift', category: 'gift_ideas', title: 'Tea', url: 'https://tea.example' }),
      item({ id: 'i-book', category: 'favourite_books', title: 'Dune', description: 'Sand' }),
      item({ id: 'i-ai1', category: 'gift_ideas', origin: 'ai', approved: false, title: 'AI 1' }),
      item({ id: 'i-ai2', category: 'gift_ideas', origin: 'ai', approved: false, title: 'AI 2' }),
    ],
    schools: [
      {
        id: 'a-1',
        affiliation_type: 'school',
        school_name: 'Hill School',
        school_location: 'SW1A 1AA',
        description: null,
        show_on_profile: true,
      },
    ],
    manualOfMe: {
      communication_style: 'Direct',
      working_preferences: null,
      energises_me: null,
      drains_me: null,
      good_to_know: 'Slow texter',
      boundaries: null,
    },
    conversationPrompts: [
      { id: 'p-1', prompt: 'Best trip?', sort_order: 1, answer_max: 500, is_active: true },
      { id: 'p-2', prompt: 'Signature dish?', sort_order: 2, answer_max: 500, is_active: true },
    ],
    conversationAnswers: [
      { id: 'q-p1', prompt_id: 'p-1', answer: 'Iceland', prompt: 'Best trip?', custom_prompt: null, answer_max: 500 },
      {
        id: 'q-c1',
        prompt_id: null,
        answer: 'Blue',
        prompt: 'Fav colour?',
        custom_prompt: 'Fav colour?',
        answer_max: null,
        sort_order: 5,
      },
      {
        id: 'q-c2',
        prompt_id: null,
        answer: 'Cats',
        prompt: 'Pets?',
        custom_prompt: 'Pets?',
        answer_max: null,
        sort_order: 7,
      },
    ],
  };
}

function setup(profileOver: Partial<LoadedProfile['profile']> = {}): { base: EditorState; cur: EditorState } {
  const base = initialEditorState(loaded(profileOver));
  return { base, cur: structuredClone(base) };
}

describe('unchanged state', () => {
  test('gives an empty payload (base_updated_at only) and is not dirty', () => {
    const { base, cur } = setup();
    expect(buildSavePayload(base, cur, 'draft')).toEqual({ base_updated_at: BASE_AT });
    expect(isDirty(base, cur)).toBe(false);
  });

  test('custom questions with null sort_order stay untouched (no renumbering)', () => {
    const l = loaded();
    l.conversationAnswers = l.conversationAnswers.map((a) => ({ ...a, sort_order: null }));
    const base = initialEditorState(l);
    expect(buildSavePayload(base, structuredClone(base), 'draft')).toEqual({ base_updated_at: BASE_AT });
  });

  test('trailing whitespace alone is not a change', () => {
    const { base, cur } = setup();
    cur.fields.headline = 'Engineer   ';
    cur.lists.causes[0].title = 'Clean rivers \n';
    cur.manualOfMe.good_to_know = 'Slow texter ';
    expect(isDirty(base, cur)).toBe(false);
    expect(buildSavePayload(base, cur, 'draft')).toEqual({ base_updated_at: BASE_AT });
  });

  test('blank new rows are dropped and do not make the editor dirty', () => {
    const { base, cur } = setup();
    cur.lists.gifts_to_avoid.push({ key: 'new:x1', id: null, category: 'gifts_to_avoid', title: '  ', description: '', url: '' });
    cur.affiliations.push({
      key: 'new:x2',
      id: null,
      affiliationType: 'community',
      name: '',
      location: '',
      description: '',
      showOnProfile: true,
    });
    cur.questions.push({ kind: 'custom', key: 'new:x3', id: null, customPrompt: '', answer: '', sortOrder: null, createdAt: null });
    expect(buildSavePayload(base, cur, 'draft')).toEqual({ base_updated_at: BASE_AT });
    expect(isDirty(base, cur)).toBe(false);
  });
});

describe('absent section = untouched', () => {
  test('editing one profile field sends only that field, no other section', () => {
    const { base, cur } = setup();
    cur.fields.city = 'Paris';
    expect(buildSavePayload(base, cur, 'draft')).toEqual({ base_updated_at: BASE_AT, profile: { city: 'Paris' } });
    expect(isDirty(base, cur)).toBe(true);
  });

  test('a cleared nullable field is sent as null', () => {
    const { base, cur } = setup();
    cur.fields.headline = '';
    expect(buildSavePayload(base, cur, 'draft').profile).toEqual({ headline: null });
  });

  test('manual_of_me is the full object when one field changed', () => {
    const { base, cur } = setup();
    cur.manualOfMe.drains_me = 'Noise';
    expect(buildSavePayload(base, cur, 'draft')).toEqual({
      base_updated_at: BASE_AT,
      manual_of_me: {
        communication_style: 'Direct',
        working_preferences: null,
        energises_me: null,
        drains_me: 'Noise',
        good_to_know: 'Slow texter',
        boundaries: null,
      },
    });
  });
});

describe('BUGS-74 regression: an untouched section never produces deletes', () => {
  test('editing only items leaves affiliations / questions / ai_gifts absent', () => {
    const { base, cur } = setup();
    cur.lists.causes[0].title = 'Clean seas';
    const p = buildSavePayload(base, cur, 'draft');
    expect(p.affiliations).toBeUndefined();
    expect(p.questions).toBeUndefined();
    expect(p.ai_gifts).toBeUndefined();
    expect(p.items).toEqual({
      upsert: [
        {
          id: 'i-cause',
          client_key: 'i-cause',
          category: 'causes',
          title: 'Clean seas',
          description: null,
          url: null,
          group_label: null,
        },
      ],
      delete: [],
    });
  });

  test('editing only the profile sends no items section at all', () => {
    const { base, cur } = setup();
    cur.fields.display_name = 'Ada L';
    const p = buildSavePayload(base, cur, 'published');
    expect(p.items).toBeUndefined();
    expect(Object.keys(p).sort()).toEqual(['base_updated_at', 'profile']);
  });
});

describe('deletes are explicit id lists', () => {
  test('a removed item is listed by id; other items are not', () => {
    const { base, cur } = setup();
    cur.lists.fav_books = [];
    expect(buildSavePayload(base, cur, 'draft').items).toEqual({ upsert: [], delete: ['i-book'] });
  });

  test('removed affiliation and question are listed by id', () => {
    const { base, cur } = setup();
    cur.affiliations = [];
    cur.questions = cur.questions.filter((q) => q.id !== 'q-p1');
    const p = buildSavePayload(base, cur, 'draft');
    expect(p.affiliations).toEqual({ upsert: [], delete: ['a-1'] });
    expect(p.questions).toEqual({ upsert: [], delete: ['q-p1'] });
  });

  test('ai gifts: approve and delete lists', () => {
    const { base, cur } = setup();
    cur.aiGifts = [{ ...cur.aiGifts[0], approved: true }];
    expect(buildSavePayload(base, cur, 'draft').ai_gifts).toEqual({ approve: ['i-ai1'], delete: ['i-ai2'] });
  });
});

describe('inserts carry client_key and no id', () => {
  test('new item', () => {
    const { base, cur } = setup();
    cur.lists.fav_books.push({
      key: 'new:b1',
      id: null,
      category: 'favourite_books',
      title: 'Emma',
      description: '',
      url: '',
    });
    expect(buildSavePayload(base, cur, 'draft').items).toEqual({
      upsert: [
        {
          client_key: 'new:b1',
          category: 'favourite_books',
          title: 'Emma',
          description: null,
          url: null,
          group_label: null,
        },
      ],
      delete: [],
    });
  });

  test('new affiliation', () => {
    const { base, cur } = setup();
    cur.affiliations.push({
      key: 'new:a9',
      id: null,
      affiliationType: 'organisation',
      name: 'Acme',
      location: '',
      description: 'Ops',
      showOnProfile: false,
    });
    expect(buildSavePayload(base, cur, 'draft').affiliations).toEqual({
      upsert: [
        {
          client_key: 'new:a9',
          affiliation_type: 'organisation',
          school_name: 'Acme',
          school_location: null,
          description: 'Ops',
          show_on_profile: false,
        },
      ],
      delete: [],
    });
  });

  test('new preset answer carries prompt_id and no sort_order', () => {
    const { base, cur } = setup();
    cur.questions.splice(1, 0, {
      kind: 'preset',
      key: 'new:p2',
      id: null,
      promptId: 'p-2',
      prompt: 'Signature dish?',
      answerMax: 500,
      answer: 'Risotto',
      isActive: true,
    });
    expect(buildSavePayload(base, cur, 'draft').questions).toEqual({
      upsert: [{ client_key: 'new:p2', prompt_id: 'p-2', answer: 'Risotto' }],
      delete: [],
    });
  });

  test('editing an existing preset answer sends no prompt_id and no sort_order', () => {
    const { base, cur } = setup();
    const q = cur.questions.find((r) => r.id === 'q-p1');
    if (q === undefined) throw new Error('fixture');
    q.answer = 'Japan';
    expect(buildSavePayload(base, cur, 'draft').questions).toEqual({
      upsert: [{ id: 'q-p1', client_key: 'q-p1', answer: 'Japan' }],
      delete: [],
    });
  });
});

describe('sort_order only on custom questions', () => {
  test('adding a custom question renumbers custom rows by position', () => {
    const { base, cur } = setup();
    cur.questions.push({
      kind: 'custom',
      key: 'new:c3',
      id: null,
      customPrompt: 'Tea or coffee?',
      answer: 'Tea',
      sortOrder: null,
      createdAt: null,
    });
    expect(buildSavePayload(base, cur, 'draft').questions).toEqual({
      upsert: [
        { id: 'q-c1', client_key: 'q-c1', custom_prompt: 'Fav colour?', answer: 'Blue', sort_order: 0 },
        { id: 'q-c2', client_key: 'q-c2', custom_prompt: 'Pets?', answer: 'Cats', sort_order: 1 },
        { client_key: 'new:c3', custom_prompt: 'Tea or coffee?', answer: 'Tea', sort_order: 2 },
      ],
      delete: [],
    });
  });

  test('editing one custom answer keeps its stored sort_order', () => {
    const { base, cur } = setup();
    const q = cur.questions.find((r) => r.id === 'q-c2');
    if (q === undefined) throw new Error('fixture');
    q.answer = 'Dogs';
    expect(buildSavePayload(base, cur, 'draft').questions).toEqual({
      upsert: [{ id: 'q-c2', client_key: 'q-c2', custom_prompt: 'Pets?', answer: 'Dogs', sort_order: 7 }],
      delete: [],
    });
  });
});

describe('photo', () => {
  test('staged photo → set with the staged path only (no URL)', () => {
    const { base, cur } = setup();
    cur.photo = { kind: 'staged', path: `${PID}/avatar-abc.jpg`, previewUrl: 'blob:preview' };
    expect(buildSavePayload(base, cur, 'draft').photo).toEqual({ action: 'set', staged_path: `${PID}/avatar-abc.jpg` });
  });

  test('removed stored photo → remove', () => {
    const { base, cur } = setup();
    cur.photo = { kind: 'removed' };
    expect(buildSavePayload(base, cur, 'draft').photo).toEqual({ action: 'remove' });
  });

  test('unchanged stored photo → photo section absent', () => {
    const { base, cur } = setup();
    expect(buildSavePayload(base, cur, 'draft').photo).toBeUndefined();
  });
});

describe('slug (CheckLyra ID)', () => {
  test('sent while not yet published', () => {
    const { base, cur } = setup();
    cur.lyraId = 'ada_lovelace';
    expect(buildSavePayload(base, cur, 'draft').profile).toEqual({ slug: 'ada_lovelace' });
  });

  test('never sent once first published', () => {
    const { base, cur } = setup({ first_published_at: '2026-11-01T00:00:00.000Z', is_published: true });
    cur.lyraId = 'ada_lovelace';
    expect(buildSavePayload(base, cur, 'publish')).toEqual({ base_updated_at: BASE_AT });
    expect(isDirty(base, cur)).toBe(false);
  });

  test('base_updated_at comes from the baseline', () => {
    const { base, cur } = setup();
    cur.baseUpdatedAt = '2099-01-01T00:00:00.000Z';
    expect(buildSavePayload(base, cur, 'draft').base_updated_at).toBe(BASE_AT);
  });
});

// ── KAN-487 review fixes ────────────────────────────────────────────────

describe('review minor 1: a stored preset answer cleared to blank is deleted', () => {
  test('goes in questions.delete, never an upsert with an empty answer', () => {
    const { base, cur } = setup();
    const preset = cur.questions.find((q) => q.id === 'q-p1');
    expect(preset).toBeDefined();
    preset!.answer = '   ';
    expect(buildSavePayload(base, cur, 'draft')).toEqual({
      base_updated_at: BASE_AT,
      questions: { upsert: [], delete: ['q-p1'] },
    });
    expect(isDirty(base, cur)).toBe(true);
  });
});

describe('a stored custom question cleared to completely blank is deleted', () => {
  test('goes in questions.delete, never an upsert with empty text', () => {
    const { base, cur } = setup();
    const custom = cur.questions.find((q) => q.kind === 'custom' && q.id !== null);
    expect(custom).toBeDefined();
    if (custom && custom.kind === 'custom') {
      custom.customPrompt = '  ';
      custom.answer = '';
    }
    const payload = buildSavePayload(base, cur, 'draft');
    expect(payload.questions?.delete).toEqual([custom!.id]);
    expect(payload.questions?.upsert.some((u) => u.id === custom!.id)).toBe(false);
  });
});

describe('review minor 7: a new row with only a link is not blank', () => {
  test('it is sent (so the server reports the missing title) and makes the editor dirty', () => {
    const { base, cur } = setup();
    cur.lists.gift_ideas.push({ key: 'new:l1', id: null, category: 'gift_ideas', title: '', description: '', url: 'https://kite.example/k' });
    expect(isDirty(base, cur)).toBe(true);
    expect(buildSavePayload(base, cur, 'draft').items).toEqual({
      upsert: [
        { client_key: 'new:l1', category: 'gift_ideas', title: '', description: null, url: 'https://kite.example/k', group_label: null },
      ],
      delete: [],
    });
  });
});
