/**
 * KAN-487 — the shared editor validator (plan §A "validate-save-payload.ts",
 * spec v0.8 §01–§10 and §3).
 *
 * Behavioural: drives the real validator with state / payload fixtures.
 * Every limit, cap and message below is a LITERAL from the spec or the
 * approved copy, never read from the module under test (CLAUDE.md failure
 * mode 10).
 */
import {
  isSavePayloadShape,
  validateEditorState,
  validatePayloadForServer,
  validateForPublish,
} from '@/modules/profile/editor/validate-save-payload';
import type {
  AffRow,
  CustomQuestionRow,
  EditorRow,
  EditorState,
  ItemCategory,
  ListKey,
  PresetQuestionRow,
  SavePayload,
} from '@/modules/profile/editor/editor-state';

// ── Fixtures ────────────────────────────────────────────────────────────

const LIST_KEYS_LITERAL: ListKey[] = [
  'causes', 'proud_of', 'gift_ideas', 'gifts_to_avoid', 'fav_quotes', 'fav_screen',
  'fav_books', 'fav_places', 'fav_others', 'life_hacks', 'current_problems',
];

function emptyLists(): Record<ListKey, EditorRow[]> {
  const out = {} as Record<ListKey, EditorRow[]>;
  for (const k of LIST_KEYS_LITERAL) out[k] = [];
  return out;
}

function baseState(over: Partial<EditorState> = {}): EditorState {
  return {
    profileId: 'p1',
    baseUpdatedAt: null,
    isPublished: false,
    firstPublishedAt: null,
    lyraIdLocked: false,
    lyraId: '',
    fields: {
      display_name: '',
      headline: '',
      city: '',
      country: '',
      bio_short: '',
      gift_voucher_hint: '',
      billboard: '',
    },
    photo: { kind: 'none' },
    lists: emptyLists(),
    aiGifts: [],
    affiliations: [],
    manualOfMe: {
      communication_style: '',
      working_preferences: '',
      energises_me: '',
      drains_me: '',
      good_to_know: '',
      boundaries: '',
    },
    questions: [],
    presets: [],
    undo: {},
    ...over,
  };
}

let seq = 0;
function row(category: ItemCategory, over: Partial<EditorRow> = {}): EditorRow {
  seq += 1;
  return { key: `k${seq}`, id: null, category, title: 'Something', description: '', url: '', ...over };
}

function withRows(listKey: ListKey, rows: EditorRow[]): EditorState {
  const lists = emptyLists();
  lists[listKey] = rows;
  return baseState({ lists });
}

function withField(key: keyof EditorState['fields'], value: string): EditorState {
  const s = baseState();
  return { ...s, fields: { ...s.fields, [key]: value } };
}

function errorsOf(state: EditorState): Record<string, string> {
  const r = validateEditorState(state);
  return r.ok ? {} : r.errors;
}

const tooLong = (label: string, n: number, max: number) =>
  `${label} is too long: ${n} characters (limit ${max}, including spaces).`;

const CAP_COPY = 'You’ve reached the limit for this section. Remove an entry to add another.';
const NO_URL_COPY = 'Links can’t be added to this section.';

// ── Baseline ────────────────────────────────────────────────────────────

test('an empty draft state is valid', () => {
  expect(validateEditorState(baseState())).toEqual({ ok: true });
});

// ── Profile fields: 60 / 100 / 80 / 80 / 500 / 350 / 200 ─────────────

const PROFILE_LIMITS: Array<[keyof EditorState['fields'], string, number]> = [
  ['display_name', 'Display name', 60],
  ['headline', 'Headline', 100],
  ['city', 'City', 80],
  ['bio_short', 'Short intro', 500],
  ['gift_voucher_hint', 'Gift preferences', 350],
  ['billboard', 'Billboard', 200],
];

describe('profile field limits', () => {
  test('corpus is non-empty', () => expect(PROFILE_LIMITS.length).toBe(6));

  test.each(PROFILE_LIMITS)('%s: exactly the limit passes, one more fails', (key, label, max) => {
    expect(errorsOf(withField(key, 'a'.repeat(max)))[`profile.${key}`]).toBeUndefined();
    expect(errorsOf(withField(key, 'a'.repeat(max + 1)))[`profile.${key}`]).toBe(tooLong(label, max + 1, max));
  });
});

describe('country', () => {
  test("'' and a valid ISO code pass", () => {
    expect(errorsOf(withField('country', ''))['profile.country']).toBeUndefined();
    expect(errorsOf(withField('country', 'GB'))['profile.country']).toBeUndefined();
  });
  test.each(['United Kingdom', 'gb', 'XX', 'GBR'])('%s is rejected', (v) => {
    expect(errorsOf(withField('country', v))['profile.country']).toBe('Choose a country from the list.');
  });
});

test('contact details in a public field get the correction message', () => {
  expect(errorsOf(withField('headline', 'Email me at ada@example.com'))['profile.headline']).toBe(
    'Headline: please remove personal information such as contact details (email, phone number or postal address). Your profile is public.',
  );
});

test('line breaks in multiline fields count toward the limit but are kept (bio 500)', () => {
  // 249 + '\n' + 250 = 500 code points
  const ok = `${'a'.repeat(249)}\n${'b'.repeat(250)}`;
  expect(errorsOf(withField('bio_short', ok))['profile.bio_short']).toBeUndefined();
});

describe('§05 manual of me (500, house 1000)', () => {
  test('working_preferences: 1000 passes, 1001 fails', () => {
    const s = baseState();
    const ok = { ...s, manualOfMe: { ...s.manualOfMe, working_preferences: 'a'.repeat(1000) } };
    const bad = { ...s, manualOfMe: { ...s.manualOfMe, working_preferences: 'a'.repeat(1001) } };
    expect(errorsOf(ok)['manual_of_me.working_preferences']).toBeUndefined();
    expect(errorsOf(bad)['manual_of_me.working_preferences']).toBe(tooLong('If you ever come to my house', 1001, 1000));
  });
  test('good_to_know: 500 passes, 501 fails', () => {
    const s = baseState();
    const ok = { ...s, manualOfMe: { ...s.manualOfMe, good_to_know: 'a'.repeat(500) } };
    const bad = { ...s, manualOfMe: { ...s.manualOfMe, good_to_know: 'a'.repeat(501) } };
    expect(errorsOf(ok)['manual_of_me.good_to_know']).toBeUndefined();
    expect(errorsOf(bad)['manual_of_me.good_to_know']).toBe(tooLong('Good to know about me', 501, 500));
  });
});

// ── CheckLyra ID ────────────────────────────────────────────────────────

describe('CheckLyra ID in the editor', () => {
  test('empty is allowed while drafting', () => {
    expect(errorsOf(baseState({ lyraId: '' }))['profile.lyra_id']).toBeUndefined();
  });
  test('an invalid ID is flagged', () => {
    expect(errorsOf(baseState({ lyraId: 'ab' }))['profile.lyra_id']).toBe(
      'Your CheckLyra ID needs at least 3 characters.',
    );
    expect(errorsOf(baseState({ lyraId: 'admin' }))['profile.lyra_id']).toBe(
      'That ID is reserved. Please choose another.',
    );
  });
  test('a locked ID is not re-validated', () => {
    expect(errorsOf(baseState({ lyraId: 'ab', lyraIdLocked: true }))['profile.lyra_id']).toBeUndefined();
  });
});

test('a published profile without a photo cannot save', () => {
  expect(errorsOf(baseState({ isPublished: true, photo: { kind: 'removed' } })).photo).toBe(
    'A published profile needs a photo. Add a new photo before removing this one.',
  );
  expect(errorsOf(baseState({ isPublished: true, photo: { kind: 'stored', url: 'https://x/a.jpg' } })).photo).toBeUndefined();
  expect(errorsOf(baseState({ isPublished: false, photo: { kind: 'removed' } })).photo).toBeUndefined();
});

// ── Items: per-category limits ──────────────────────────────────────────

// [listKey, category, titleLabel, titleMax, descriptionLabel, descriptionMax]
const ITEM_LIMITS: Array<[ListKey, ItemCategory, string, number, string, number]> = [
  ['causes', 'causes', 'Title', 250, 'Description', 250],
  ['proud_of', 'proud_of', 'Title', 250, 'Description', 250],
  ['gift_ideas', 'gift_ideas', 'Title', 100, 'Description', 250],
  ['gifts_to_avoid', 'gifts_to_avoid', 'Title', 100, 'Description', 200],
  ['fav_quotes', 'quotes', 'Quote', 500, 'Author / Speaker / Character', 120],
  ['fav_screen', 'favourite_media', 'Title', 120, 'Description', 300],
  ['fav_books', 'favourite_books', 'Title', 120, 'Description', 300],
  ['fav_places', 'favourite_places', 'Title', 120, 'Description', 300],
  ['fav_others', 'favourite_custom', 'Title', 120, 'Description', 300],
  ['life_hacks', 'life_hacks', 'Title', 120, 'Description', 500],
  ['current_problems', 'current_problems', 'Title', 120, 'Description', 500],
];

describe('item limits by category', () => {
  test('corpus is non-empty', () => expect(ITEM_LIMITS.length).toBe(11));

  test.each(ITEM_LIMITS)('%s title: limit passes, +1 fails', (listKey, category, tLabel, tMax) => {
    const ok = row(category, { title: 'a'.repeat(tMax) });
    const bad = row(category, { title: 'a'.repeat(tMax + 1) });
    expect(errorsOf(withRows(listKey, [ok]))[`${ok.key}.title`]).toBeUndefined();
    expect(errorsOf(withRows(listKey, [bad]))[`${bad.key}.title`]).toBe(tooLong(tLabel, tMax + 1, tMax));
  });

  test.each(ITEM_LIMITS)('%s description: limit passes, +1 fails', (listKey, category, _t, _tm, dLabel, dMax) => {
    const ok = row(category, { description: 'a'.repeat(dMax) });
    const bad = row(category, { description: 'a'.repeat(dMax + 1) });
    expect(errorsOf(withRows(listKey, [ok]))[`${ok.key}.description`]).toBeUndefined();
    expect(errorsOf(withRows(listKey, [bad]))[`${bad.key}.description`]).toBe(tooLong(dLabel, dMax + 1, dMax));
  });
});

describe('required title on non-blank rows', () => {
  test('a row with only a description needs a title', () => {
    const r = row('causes', { title: '', description: 'why it matters' });
    expect(errorsOf(withRows('causes', [r]))[`${r.key}.title`]).toBe('Title is required.');
  });
  test('quotes say "Quote is required."', () => {
    const r = row('quotes', { title: '', description: 'Ada Lovelace' });
    expect(errorsOf(withRows('fav_quotes', [r]))[`${r.key}.title`]).toBe('Quote is required.');
  });
  test('a fully blank row is ignored', () => {
    const r = row('gift_ideas', { title: '  ', description: '', url: '' });
    expect(validateEditorState(withRows('gift_ideas', [r]))).toEqual({ ok: true });
  });
});

// ── URLs ────────────────────────────────────────────────────────────────

const NO_URL: Array<[ListKey, ItemCategory]> = [
  ['fav_quotes', 'quotes'],
  ['causes', 'causes'],
  ['proud_of', 'proud_of'],
  ['gifts_to_avoid', 'gifts_to_avoid'],
  ['current_problems', 'current_problems'],
];
const URL_OK: Array<[ListKey, ItemCategory]> = [
  ['gift_ideas', 'gift_ideas'],
  ['fav_screen', 'favourite_media'],
  ['fav_books', 'favourite_books'],
  ['fav_places', 'favourite_places'],
  ['fav_others', 'favourite_custom'],
  ['life_hacks', 'life_hacks'],
];

describe('links', () => {
  test('corpora are non-empty', () => {
    expect(NO_URL.length).toBe(5);
    expect(URL_OK.length).toBe(6);
  });

  test.each(NO_URL)('%s rejects any link', (listKey, category) => {
    const r = row(category, { url: 'https://example.com' });
    expect(errorsOf(withRows(listKey, [r]))[`${r.key}.url`]).toBe(NO_URL_COPY);
  });

  test.each(URL_OK)('%s accepts an https link', (listKey, category) => {
    const r = row(category, { url: 'https://example.com/x' });
    expect(errorsOf(withRows(listKey, [r]))[`${r.key}.url`]).toBeUndefined();
  });

  test('a non-http link is rejected with the step-3 message', () => {
    const r = row('gift_ideas', { url: 'javascript:alert(1)' });
    expect(errorsOf(withRows('gift_ideas', [r]))[`${r.key}.url`]).toBe(
      'Invalid URL — must start with http:// or https://',
    );
  });

  test('a link longer than 2,048 characters is rejected', () => {
    const r = row('gift_ideas', { url: `https://example.com/${'a'.repeat(2048)}` });
    expect(errorsOf(withRows('gift_ideas', [r]))[`${r.key}.url`]).toBe('That link is too long (limit 2,048 characters).');
  });
});

// ── Caps ────────────────────────────────────────────────────────────────

// [listKey, category, cap]
const CAPS: Array<[ListKey, ItemCategory, number]> = [
  ['causes', 'causes', 6],
  ['proud_of', 'proud_of', 6],
  ['gift_ideas', 'gift_ideas', 25],
  ['gifts_to_avoid', 'gifts_to_avoid', 15],
  ['fav_quotes', 'quotes', 15],
  ['fav_screen', 'favourite_media', 15],
  ['fav_books', 'favourite_books', 15],
  ['fav_places', 'favourite_places', 15],
  ['fav_others', 'favourite_custom', 15],
  ['life_hacks', 'life_hacks', 15],
  ['current_problems', 'current_problems', 10],
];

const rowsOf = (category: ItemCategory, n: number) => Array.from({ length: n }, () => row(category));

describe('caps per group', () => {
  test('corpus is non-empty', () => expect(CAPS.length).toBe(11));

  test.each(CAPS)('%s: cap passes, cap + 1 fails', (listKey, category, cap) => {
    expect(errorsOf(withRows(listKey, rowsOf(category, cap)))[`lists.${listKey}`]).toBeUndefined();
    expect(errorsOf(withRows(listKey, rowsOf(category, cap + 1)))[`lists.${listKey}`]).toBe(CAP_COPY);
  });

  test('blank rows do not count toward a cap', () => {
    const rows = [...rowsOf('causes', 6), row('causes', { title: '' })];
    expect(errorsOf(withRows('causes', rows))['lists.causes']).toBeUndefined();
  });

  test('legacy screen categories share the Movies / Theatre / TV cap of 15', () => {
    const rows = [...rowsOf('favourite_media', 6), ...rowsOf('plays', 5), ...rowsOf('favourite_tv', 5)];
    expect(errorsOf(withRows('fav_screen', rows))['lists.fav_screen']).toBe(CAP_COPY);
  });
});

function aff(type: AffRow['affiliationType'], over: Partial<AffRow> = {}): AffRow {
  seq += 1;
  return {
    key: `a${seq}`,
    id: null,
    affiliationType: type,
    name: 'Some place',
    location: type === 'school' ? 'SW1A 1AA' : '',
    description: '',
    showOnProfile: false,
    ...over,
  };
}

describe('affiliations', () => {
  test.each(['school', 'organisation', 'community'] as const)('%s: 7 pass, 8 fail', (type) => {
    const seven = Array.from({ length: 7 }, () => aff(type));
    const eight = Array.from({ length: 8 }, () => aff(type));
    expect(errorsOf(baseState({ affiliations: seven }))[`affiliations.${type}`]).toBeUndefined();
    expect(errorsOf(baseState({ affiliations: eight }))[`affiliations.${type}`]).toBe(CAP_COPY);
  });

  test('the cap is per type: 7 of each passes', () => {
    const rows = (['school', 'organisation', 'community'] as const).flatMap((t) =>
      Array.from({ length: 7 }, () => aff(t)),
    );
    expect(validateEditorState(baseState({ affiliations: rows }))).toEqual({ ok: true });
  });

  test('name 120 passes, 121 fails; required', () => {
    const ok = aff('organisation', { name: 'a'.repeat(120) });
    const bad = aff('organisation', { name: 'a'.repeat(121) });
    const missing = aff('organisation', { name: '', description: 'x' });
    const e = errorsOf(baseState({ affiliations: [ok, bad, missing] }));
    expect(e[`${ok.key}.name`]).toBeUndefined();
    expect(e[`${bad.key}.name`]).toBe(tooLong('Name', 121, 120));
    expect(e[`${missing.key}.name`]).toBe('Name is required.');
  });

  test('school postcode: 12 max, required, must contain a letter and a digit', () => {
    const POSTCODE = 'Schools need a postcode (full or partial) so people can tell schools with the same name apart.';
    const ok = aff('school', { location: 'AB12 3CD' });
    const tooLongPc = aff('school', { location: 'AB12 3CDEFGH1' }); // 13
    const missing = aff('school', { location: '' });
    const lettersOnly = aff('school', { location: 'London' });
    const e = errorsOf(baseState({ affiliations: [ok, tooLongPc, missing, lettersOnly] }));
    expect(e[`${ok.key}.location`]).toBeUndefined();
    expect(e[`${tooLongPc.key}.location`]).toBe(tooLong('Postcode', 13, 12));
    expect(e[`${missing.key}.location`]).toBe(POSTCODE);
    expect(e[`${lettersOnly.key}.location`]).toBe(POSTCODE);
  });

  test('organisation location is optional, 120 max', () => {
    const none = aff('organisation', { location: '' });
    const bad = aff('community', { location: 'a'.repeat(121) });
    const e = errorsOf(baseState({ affiliations: [none, bad] }));
    expect(e[`${none.key}.location`]).toBeUndefined();
    expect(e[`${bad.key}.location`]).toBe(tooLong('Location', 121, 120));
  });

  test('description 250 passes, 251 fails', () => {
    const ok = aff('community', { description: 'a'.repeat(250) });
    const bad = aff('community', { description: 'a'.repeat(251) });
    const e = errorsOf(baseState({ affiliations: [ok, bad] }));
    expect(e[`${ok.key}.description`]).toBeUndefined();
    expect(e[`${bad.key}.description`]).toBe(tooLong('Description', 251, 250));
  });
});

// ── Questions ───────────────────────────────────────────────────────────

function custom(over: Partial<CustomQuestionRow> = {}): CustomQuestionRow {
  seq += 1;
  return { kind: 'custom', key: `q${seq}`, id: null, customPrompt: 'Why?', answer: 'Because.', sortOrder: null, createdAt: null, ...over };
}
function preset(over: Partial<PresetQuestionRow> = {}): PresetQuestionRow {
  seq += 1;
  return { kind: 'preset', key: `q${seq}`, id: null, promptId: 'pp1', prompt: 'P?', answerMax: 300, answer: 'yes', isActive: true, ...over };
}

describe('questions', () => {
  test('custom question 180 passes, 181 fails', () => {
    const ok = custom({ customPrompt: 'a'.repeat(180) });
    const bad = custom({ customPrompt: 'a'.repeat(181) });
    const e = errorsOf(baseState({ questions: [ok, bad] }));
    expect(e[`${ok.key}.custom_prompt`]).toBeUndefined();
    expect(e[`${bad.key}.custom_prompt`]).toBe(tooLong('Your question', 181, 180));
  });

  test('custom answer 500 passes, 501 fails', () => {
    const ok = custom({ answer: 'a'.repeat(500) });
    const bad = custom({ answer: 'a'.repeat(501) });
    const e = errorsOf(baseState({ questions: [ok, bad] }));
    expect(e[`${ok.key}.answer`]).toBeUndefined();
    expect(e[`${bad.key}.answer`]).toBe(tooLong('Your answer', 501, 500));
  });

  test("preset answer limit is that prompt's answer_max", () => {
    const ok = preset({ answerMax: 300, answer: 'a'.repeat(300) });
    const bad = preset({ answerMax: 300, answer: 'a'.repeat(301) });
    const big = preset({ answerMax: 800, answer: 'a'.repeat(800) });
    const e = errorsOf(baseState({ questions: [ok, bad, big] }));
    expect(e[`${ok.key}.answer`]).toBeUndefined();
    expect(e[`${bad.key}.answer`]).toBe(tooLong('Your answer', 301, 300));
    expect(e[`${big.key}.answer`]).toBeUndefined();
  });

  test('an unanswered preset is fine', () => {
    expect(validateEditorState(baseState({ questions: [preset({ answer: '' })] }))).toEqual({ ok: true });
  });

  test('10 custom questions pass, 11 fail', () => {
    const ten = Array.from({ length: 10 }, () => custom());
    const eleven = Array.from({ length: 11 }, () => custom());
    expect(errorsOf(baseState({ questions: ten }))['questions.custom']).toBeUndefined();
    expect(errorsOf(baseState({ questions: eleven }))['questions.custom']).toBe(
      'You can write up to 10 of your own questions. Remove one to add another.',
    );
  });

  test('answered presets do not count toward the custom cap', () => {
    const qs = [...Array.from({ length: 10 }, () => custom()), ...Array.from({ length: 16 }, () => preset())];
    expect(errorsOf(baseState({ questions: qs }))['questions.custom']).toBeUndefined();
  });
});

// ── validateForPublish ──────────────────────────────────────────────────

describe('validateForPublish', () => {
  test('returns ALL three missing identity items together', () => {
    expect(validateForPublish(baseState())).toEqual([
      'Add a profile photo',
      'Add a display name',
      'Choose a CheckLyra ID',
    ]);
  });

  test('complete identity → no errors', () => {
    const s = withField('display_name', 'Ada');
    expect(validateForPublish({ ...s, lyraId: 'ada_l', photo: { kind: 'staged', path: 'u/avatar-1.jpg', previewUrl: 'blob:x' } })).toEqual([]);
  });

  test('an invalid or reserved ID counts as missing', () => {
    const s = { ...withField('display_name', 'Ada'), photo: { kind: 'stored', url: 'https://x/a.jpg' } as const };
    expect(validateForPublish({ ...s, lyraId: 'admin' })).toEqual(['Choose a CheckLyra ID']);
    expect(validateForPublish({ ...s, lyraId: 'a-b-c' })).toEqual(['Choose a CheckLyra ID']);
  });

  test('a whitespace-only display name and a removed photo are missing', () => {
    const s = { ...withField('display_name', '   '), lyraId: 'ada_l', photo: { kind: 'removed' } as const };
    expect(validateForPublish(s)).toEqual(['Add a profile photo', 'Add a display name']);
  });
});

// ── validatePayloadForServer ────────────────────────────────────────────

describe('validatePayloadForServer', () => {
  const base: SavePayload = { base_updated_at: null };

  test('an empty diff is valid', () => {
    expect(validatePayloadForServer(base, { mode: 'published' })).toEqual({
      ok: true,
      payload: { base_updated_at: null },
      warnings: {},
    });
  });

  test('only present profile fields are checked, with the same messages', () => {
    const r = validatePayloadForServer({ ...base, profile: { headline: 'a'.repeat(101), country: 'Narnia' } }, { mode: 'draft' });
    expect(r).toEqual({
      ok: false,
      errors: { 'profile.headline': tooLong('Headline', 101, 100), 'profile.country': 'Choose a country from the list.' },
      warnings: {},
    });
  });

  test('country null clears and passes', () => {
    expect(validatePayloadForServer({ ...base, profile: { country: null } }, { mode: 'draft' }).ok).toBe(true);
  });

  test('item upserts: no-URL categories, limits, keyed by client_key', () => {
    const r = validatePayloadForServer(
      {
        ...base,
        items: {
          upsert: [
            { client_key: 'new:1', category: 'quotes', title: 'q', description: null, url: 'https://e.com', group_label: null },
            { client_key: 'new:2', category: 'gift_ideas', title: 'a'.repeat(101), description: null, url: null, group_label: null },
            { client_key: 'new:3', category: 'life_hacks', title: 'ok', description: null, url: 'https://e.com', group_label: null },
          ],
          delete: [],
        },
      },
      { mode: 'published' },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual({
      'new:1.url': NO_URL_COPY,
      'new:2.title': tooLong('Title', 101, 100),
    });
  });

  test('a legacy category cannot be written through the editor', () => {
    const r = validatePayloadForServer(
      { ...base, items: { upsert: [{ client_key: 'k', category: 'likes', title: 't', description: null, url: null, group_label: null }], delete: [] } },
      { mode: 'draft' },
    );
    expect(r.ok).toBe(false);
  });

  test('affiliation upserts: school postcode required', () => {
    const r = validatePayloadForServer(
      {
        ...base,
        affiliations: {
          upsert: [{ client_key: 'a', affiliation_type: 'school', school_name: 'X', school_location: null, description: null, show_on_profile: false }],
          delete: [],
        },
      },
      { mode: 'draft' },
    );
    expect(r).toEqual({
      ok: false,
      errors: { 'a.location': 'Schools need a postcode (full or partial) so people can tell schools with the same name apart.' },
      warnings: {},
    });
  });

  test('question upserts: preset limit from context, custom 180 / 500', () => {
    const ctx = { mode: 'published' as const, presetAnswerMax: new Map([['pp1', 200]]) };
    const r = validatePayloadForServer(
      {
        ...base,
        questions: {
          upsert: [
            { client_key: 'p', prompt_id: 'pp1', answer: 'a'.repeat(201) },
            { client_key: 'c', custom_prompt: 'a'.repeat(181), answer: 'a'.repeat(501), sort_order: 0 },
          ],
          delete: [],
        },
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual({
      'p.answer': tooLong('Your answer', 201, 200),
      'c.custom_prompt': tooLong('Your question', 181, 180),
      'c.answer': tooLong('Your answer', 501, 500),
    });
  });

  test('manual_of_me: limits and contact details; null clears', () => {
    expect(validatePayloadForServer({ ...base, manual_of_me: null }, { mode: 'draft' }).ok).toBe(true);
    const r = validatePayloadForServer(
      {
        ...base,
        manual_of_me: {
          communication_style: 'Call me on 07700 900123',
          working_preferences: null,
          energises_me: null,
          drains_me: 'a'.repeat(501),
          good_to_know: null,
          boundaries: null,
        },
      },
      { mode: 'draft' },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual({
      'manual_of_me.communication_style':
        'How I find communication easier: please remove personal information such as contact details (email, phone number or postal address). Your profile is public.',
      'manual_of_me.drains_me': tooLong('What drains me', 501, 500),
    });
  });

  test('slug: draft → warning only; publish → error; published → locked', () => {
    expect(validatePayloadForServer({ ...base, profile: { slug: 'ab' } }, { mode: 'draft' })).toEqual({
      ok: true,
      payload: { base_updated_at: null },
      warnings: { lyra_id: 'Your CheckLyra ID needs at least 3 characters.' },
    });
    expect(validatePayloadForServer({ ...base, profile: { slug: 'ab' } }, { mode: 'publish' })).toEqual({
      ok: false,
      errors: { 'profile.lyra_id': 'Your CheckLyra ID needs at least 3 characters.' },
      warnings: {},
    });
    expect(validatePayloadForServer({ ...base, profile: { slug: 'ada_l' } }, { mode: 'publish' }).ok).toBe(true);
    expect(validatePayloadForServer({ ...base, profile: { slug: 'ada_l' } }, { mode: 'published' })).toEqual({
      ok: false,
      errors: { 'profile.lyra_id': 'Your CheckLyra ID can’t be changed after publishing.' },
      warnings: {},
    });
  });

  test('a published save may not remove the photo', () => {
    expect(validatePayloadForServer({ ...base, photo: { action: 'remove' } }, { mode: 'published' })).toEqual({
      ok: false,
      errors: { photo: 'A published profile needs a photo. Add a new photo before removing this one.' },
      warnings: {},
    });
    expect(validatePayloadForServer({ ...base, photo: { action: 'remove' } }, { mode: 'draft' }).ok).toBe(true);
  });
});

// ── KAN-487 review fixes ────────────────────────────────────────────────

describe('review M1: validatePayloadForServer returns the CLEANED payload', () => {
  test('every text is the validated value (null when empty); links are the parsed URL', () => {
    const r = validatePayloadForServer(
      {
        base_updated_at: '2026-11-23T10:00:00.000Z',
        profile: { display_name: ' <b>Ada</b>  L ', city: '   ', country: 'GB', slug: 'Ada_L' },
        photo: { action: 'keep' },
        items: {
          upsert: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              client_key: '11111111-1111-4111-8111-111111111111',
              category: 'gift_ideas',
              title: '<img src=x onerror=alert(1)>Kite',
              description: '',
              url: ' https://kite.example/k ',
              group_label: null,
            },
            {
              client_key: 'new:1',
              category: 'favourite_custom',
              title: 'Song',
              description: '<p>Loud</p>',
              url: null,
              group_label: '<i>Music</i>',
            },
          ],
          delete: ['22222222-2222-4222-8222-222222222222'],
        },
        ai_gifts: { approve: ['33333333-3333-4333-8333-333333333333'], delete: [] },
        questions: {
          upsert: [{ id: '44444444-4444-4444-8444-444444444444', client_key: 'q', answer: ' <b>Yes</b> ' }],
          delete: [],
        },
        manual_of_me: null,
      },
      { mode: 'draft' },
    );
    expect(r).toEqual({
      ok: true,
      warnings: {},
      payload: {
        base_updated_at: '2026-11-23T10:00:00.000Z',
        profile: { display_name: 'Ada L', city: null, country: 'GB', slug: 'ada_l' },
        photo: { action: 'keep' },
        items: {
          upsert: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              client_key: '11111111-1111-4111-8111-111111111111',
              category: 'gift_ideas',
              title: 'Kite',
              description: null,
              url: 'https://kite.example/k',
              group_label: null,
            },
            {
              client_key: 'new:1',
              category: 'favourite_custom',
              title: 'Song',
              description: 'Loud',
              url: null,
              group_label: 'Music',
            },
          ],
          delete: ['22222222-2222-4222-8222-222222222222'],
        },
        ai_gifts: { approve: ['33333333-3333-4333-8333-333333333333'], delete: [] },
        questions: {
          upsert: [{ id: '44444444-4444-4444-8444-444444444444', client_key: 'q', answer: 'Yes' }],
          delete: [],
        },
        manual_of_me: null,
      },
    });
  });

  test('group_label is checked on the stripped value (61 visible characters fails)', () => {
    const r = validatePayloadForServer(
      {
        base_updated_at: null,
        items: {
          upsert: [{ client_key: 'k', category: 'favourite_custom', title: 'T', description: null, url: null, group_label: 'g'.repeat(61) }],
          delete: [],
        },
      },
      { mode: 'draft' },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors)).toEqual(['k.group_label']);
  });
});

describe('review M3: publish and published modes require a display name', () => {
  test.each([['publish'], ['published']] as const)('%s: a blank display_name → "Add a display name"', (mode) => {
    for (const blank of ['', '   ', '<b> </b>']) {
      expect(validatePayloadForServer({ base_updated_at: null, profile: { display_name: blank } }, { mode })).toEqual({
        ok: false,
        errors: { 'profile.display_name': 'Add a display name' },
        warnings: {},
      });
    }
  });

  test('draft: a blank display_name is allowed (identity is optional before publishing)', () => {
    expect(validatePayloadForServer({ base_updated_at: null, profile: { display_name: '' } }, { mode: 'draft' })).toEqual({
      ok: true,
      payload: { base_updated_at: null, profile: { display_name: '' } },
      warnings: {},
    });
  });

  test('published: a diff that does not touch display_name is not affected', () => {
    expect(validatePayloadForServer({ base_updated_at: null, profile: { headline: 'Hi' } }, { mode: 'published' }).ok).toBe(true);
  });
});

describe('review minor 6: isSavePayloadShape', () => {
  const ID = '11111111-1111-4111-8111-111111111111';
  test('accepts a full, well-formed payload and an empty diff', () => {
    expect(isSavePayloadShape({ base_updated_at: null })).toBe(true);
    expect(
      isSavePayloadShape({
        base_updated_at: '2026-11-23T10:00:00.000Z',
        profile: { display_name: 'Ada', headline: null, slug: 'ada_l' },
        photo: { action: 'set', staged_path: 'u/avatar-1.jpg' },
        items: { upsert: [{ id: ID, client_key: ID, category: 'gift_ideas', title: 'T', description: null, url: null, group_label: null }], delete: [ID] },
        ai_gifts: { approve: [ID], delete: [] },
        affiliations: {
          upsert: [{ client_key: 'new:a', affiliation_type: 'school', school_name: 'S', school_location: 'SW1A 1AA', description: null, show_on_profile: true }],
          delete: [],
        },
        manual_of_me: { good_to_know: 'x', boundaries: null },
        questions: { upsert: [{ client_key: 'new:q', prompt_id: ID, answer: 'A' }, { id: ID, client_key: ID, custom_prompt: 'Q', answer: 'A', sort_order: 2 }], delete: [] },
      }),
    ).toBe(true);
  });

  const bad: Array<[string, unknown]> = [
    ['null', null],
    ['an array', []],
    ['items.upsert as an object', { base_updated_at: null, items: { upsert: {}, delete: [] } }],
    ['questions.delete with a non-UUID', { base_updated_at: null, questions: { upsert: [], delete: ['1'] } }],
    ['a fractional sort_order', { base_updated_at: null, questions: { upsert: [{ client_key: 'k', custom_prompt: 'Q', answer: 'A', sort_order: 1.5 }], delete: [] } }],
    ['an empty client_key', { base_updated_at: null, items: { upsert: [{ client_key: '', category: 'gift_ideas', title: 'T', description: null, url: null, group_label: null }], delete: [] } }],
    ['a null title', { base_updated_at: null, items: { upsert: [{ client_key: 'k', category: 'gift_ideas', title: null, description: null, url: null, group_label: null }], delete: [] } }],
    ['slug as null', { base_updated_at: null, profile: { slug: null } }],
  ];
  test('the malformed corpus is non-empty', () => {
    expect(bad.length).toBeGreaterThan(0);
  });
  test.each(bad)('rejects %s without throwing', (_label, v) => {
    expect(() => isSavePayloadShape(v)).not.toThrow();
    expect(isSavePayloadShape(v)).toBe(false);
  });
});
