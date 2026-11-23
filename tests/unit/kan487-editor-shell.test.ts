/**
 * KAN-487 — v0.8 editor shell logic (spec v0.8 §1, §3; plan §B "Modes",
 * §C "Action bar" / "Unsaved-changes warning").
 *
 * Behavioural: states are built through the real `initialEditorState` and
 * edited through the real `editorReducer`; payloads come from the real
 * `buildSavePayload`. Expected values are literals (CLAUDE.md failure mode 10).
 */
import { buildSavePayload, isDirty } from '@/modules/profile/editor/editor-diff';
import { editorReducer, type EditorAction } from '@/modules/profile/editor/editor-reducer';
import {
  initialEditorState,
  type EditorState,
  type LoadedProfile,
} from '@/modules/profile/editor/editor-state';
import {
  SAVE_SUCCESS_COPY,
  UNSAVED_COPY,
  afterBackConfirm,
  domSafeKey,
  editorShellReducer,
  errorKeysForFieldId,
  failedIntentAfter,
  historyGuardStep,
  isGuardState,
  isReloadError,
  liveServerErrors,
  lyraIdWarningMessage,
  popstateStep,
  remapKeySet,
  retryIntent,
  saveFailureStatus,
  touchField,
  MODE_FOR_INTENT,
  publishBlockerErrors,
  publishBlockers,
  rebaseAfterSave,
  saveChangesDisabled,
  shouldGuardLinkClick,
  touchErrors,
  visibleErrors,
} from '@/modules/profile/editor/editor-shell';

const PID = '00000000-0000-4000-8000-000000000001';
const BASE_AT = '2026-11-23T10:00:00.000Z';
const NEXT_AT = '2026-11-23T10:05:00.000Z';

function loaded(over: Partial<LoadedProfile['profile']> = {}): LoadedProfile {
  return {
    profile: {
      id: PID,
      display_name: 'Ada',
      slug: 'ada_l',
      slug_confirmed: true,
      first_published_at: '2026-11-01T00:00:00.000Z',
      is_published: true,
      avatar_url: 'https://cdn.example/ada/avatar-1.jpg',
      headline: 'Engineer',
      city: 'London',
      country: 'GB',
      bio_short: null,
      gift_voucher_hint: null,
      billboard: null,
      updated_at: BASE_AT,
      ...over,
    },
    items: [
      {
        id: 'i-tip',
        category: 'life_hacks',
        title: 'Batch cook',
        description: null,
        url: null,
        group_label: null,
        origin: 'user',
        approved: true,
      },
    ],
    schools: [],
    manualOfMe: null,
    conversationPrompts: [],
    conversationAnswers: [],
  };
}

function run(state: EditorState, ...actions: EditorAction[]): EditorState {
  return actions.reduce(editorReducer, state);
}

function ok(over: Partial<{ slug: string | null; slugConfirmed: boolean; warnings: Record<string, string> }> = {}) {
  return {
    updatedAt: NEXT_AT,
    isPublished: true,
    firstPublishedAt: '2026-11-01T00:00:00.000Z',
    avatarUrl: 'https://cdn.example/ada/avatar-1.jpg',
    slug: over.slug === undefined ? 'ada_l' : over.slug,
    slugConfirmed: over.slugConfirmed ?? true,
    warnings: over.warnings ?? {},
  };
}

describe('copy', () => {
  test('success copy is exactly the spec string', () => {
    expect(SAVE_SUCCESS_COPY).toBe('Changes saved successfully');
  });
  test('unsaved warning copy', () => {
    expect(UNSAVED_COPY).toBe(
      'You have unsaved changes. Leave without saving? Your public profile will stay as it is.',
    );
  });
});

describe('rebaseAfterSave — baseline is the SENT snapshot', () => {
  test('a new row saved, then the editor is clean and the next save sends nothing', () => {
    const base = initialEditorState(loaded());
    const sent = run(base, { type: 'addRow', listKey: 'life_hacks', key: 'new:k1' }, {
      type: 'updateRow',
      listKey: 'life_hacks',
      key: 'new:k1',
      patch: { title: 'Meal plan' },
    });
    const { baseline, live } = rebaseAfterSave(sent, sent, { 'new:k1': 'id-1' }, ok());
    expect(live.lists.life_hacks.map((r) => [r.key, r.id, r.title])).toEqual([
      ['i-tip', 'i-tip', 'Batch cook'],
      ['id-1', 'id-1', 'Meal plan'],
    ]);
    expect(baseline.baseUpdatedAt).toBe(NEXT_AT);
    expect(live.baseUpdatedAt).toBe(NEXT_AT);
    expect(isDirty(baseline, live)).toBe(false);
    expect(buildSavePayload(baseline, live, 'published')).toEqual({ base_updated_at: NEXT_AT });
  });

  test('an edit typed while the save was in flight stays and is sent next time', () => {
    const base = initialEditorState(loaded());
    const sent = run(base, { type: 'setField', field: 'headline', value: 'Pilot' });
    const liveDuring = run(sent, { type: 'setField', field: 'headline', value: 'Pilot and baker' });
    const { baseline, live } = rebaseAfterSave(sent, liveDuring, {}, ok());
    expect(baseline.fields.headline).toBe('Pilot');
    expect(live.fields.headline).toBe('Pilot and baker');
    expect(buildSavePayload(baseline, live, 'published')).toEqual({
      base_updated_at: NEXT_AT,
      profile: { headline: 'Pilot and baker' },
    });
  });

  test('a new row edited during the save is UPDATED next time, never inserted twice', () => {
    const base = initialEditorState(loaded());
    const sent = run(
      base,
      { type: 'addRow', listKey: 'life_hacks', key: 'new:k1' },
      { type: 'updateRow', listKey: 'life_hacks', key: 'new:k1', patch: { title: 'Meal plan' } },
    );
    const liveDuring = run(sent, {
      type: 'updateRow',
      listKey: 'life_hacks',
      key: 'new:k1',
      patch: { title: 'Meal plan on Sundays' },
    });
    const r = rebaseAfterSave(sent, liveDuring, { 'new:k1': 'id-1' }, ok());
    expect(buildSavePayload(r.baseline, r.live, 'published')).toEqual({
      base_updated_at: NEXT_AT,
      items: {
        upsert: [
          {
            id: 'id-1',
            client_key: 'id-1',
            category: 'life_hacks',
            title: 'Meal plan on Sundays',
            description: null,
            url: null,
            group_label: null,
          },
        ],
        delete: [],
      },
    });
  });

  test('a saved new row removed during the save is DELETED next time', () => {
    const base = initialEditorState(loaded());
    const sent = run(
      base,
      { type: 'addRow', listKey: 'life_hacks', key: 'new:k1' },
      { type: 'updateRow', listKey: 'life_hacks', key: 'new:k1', patch: { title: 'Meal plan' } },
    );
    const liveDuring = run(sent, { type: 'removeRow', listKey: 'life_hacks', key: 'new:k1', at: 5 });
    const r = rebaseAfterSave(sent, liveDuring, { 'new:k1': 'id-1' }, ok());
    expect(buildSavePayload(r.baseline, r.live, 'published')).toEqual({
      base_updated_at: NEXT_AT,
      items: { upsert: [], delete: ['id-1'] },
    });
    // The removal made during the save can still be undone, with its stored id.
    const restored = editorShellReducer(r.live, { type: 'undoRemove', listKey: 'life_hacks' });
    expect(restored.lists.life_hacks.map((x) => x.key)).toEqual(['i-tip', 'id-1']);
    expect(isDirty(r.baseline, restored)).toBe(false);
  });

  test('undo entries pending when the save started are dropped (the save committed them)', () => {
    const base = initialEditorState(loaded());
    const sent = run(base, { type: 'removeRow', listKey: 'life_hacks', key: 'i-tip', at: 1 });
    const r = rebaseAfterSave(sent, sent, {}, ok());
    expect(r.live.undo).toEqual({});
  });

  test('a photo picked during the save stays in the live state (still dirty)', () => {
    const base = initialEditorState(loaded());
    const sent = run(base, { type: 'setField', field: 'city', value: 'Leeds' });
    const liveDuring = run(sent, {
      type: 'setPhoto',
      photo: { kind: 'staged', path: 'u/avatar-2.jpg', previewUrl: 'blob:x' },
    });
    const r = rebaseAfterSave(sent, liveDuring, {}, ok());
    expect(r.live.photo).toEqual({ kind: 'staged', path: 'u/avatar-2.jpg', previewUrl: 'blob:x' });
    expect(r.baseline.photo).toEqual({ kind: 'stored', url: 'https://cdn.example/ada/avatar-1.jpg' });
    expect(isDirty(r.baseline, r.live)).toBe(true);
  });

  test('a staged photo that was SAVED becomes the stored photo in both (clean)', () => {
    const base = initialEditorState(loaded());
    const sent = run(base, {
      type: 'setPhoto',
      photo: { kind: 'staged', path: 'u/avatar-2.jpg', previewUrl: 'blob:x' },
    });
    const result = { ...ok(), avatarUrl: 'https://cdn.example/ada/avatar-2.jpg' };
    const r = rebaseAfterSave(sent, sent, {}, result);
    expect(r.live.photo).toEqual({ kind: 'stored', url: 'https://cdn.example/ada/avatar-2.jpg' });
    expect(isDirty(r.baseline, r.live)).toBe(false);
  });

  test('a refused CheckLyra ID (draft) keeps the typed ID live, so the editor stays dirty', () => {
    const base = initialEditorState(
      loaded({ is_published: false, first_published_at: null, slug: 'user_ab12cd34ef', slug_confirmed: false }),
    );
    const sent = run(base, { type: 'setLyraId', value: 'bob' });
    const r = rebaseAfterSave(
      sent,
      sent,
      {},
      { ...ok({ slug: 'user_ab12cd34ef', slugConfirmed: false, warnings: { lyra_id: 'taken' } }), isPublished: false, firstPublishedAt: null },
    );
    expect(r.baseline.lyraId).toBe('');
    expect(r.live.lyraId).toBe('bob');
    expect(buildSavePayload(r.baseline, r.live, 'draft')).toEqual({
      base_updated_at: NEXT_AT,
      profile: { slug: 'bob' },
    });
  });

  test('a successful first publish locks the ID in the live state', () => {
    const base = initialEditorState(loaded({ is_published: false, first_published_at: null }));
    const r = rebaseAfterSave(base, base, {}, ok());
    expect(r.live.isPublished).toBe(true);
    expect(r.live.lyraIdLocked).toBe(true);
    expect(r.live.lyraId).toBe('ada_l');
  });

  test('editorShellReducer rebases the CURRENT state', () => {
    const base = initialEditorState(loaded());
    const sent = run(base, { type: 'addRow', listKey: 'life_hacks', key: 'new:k1' });
    const current = run(sent, { type: 'setField', field: 'city', value: 'York' });
    const next = editorShellReducer(current, {
      type: 'rebaseAfterSave',
      sent,
      idMap: { 'new:k1': 'id-1' },
      newBaseline: ok(),
    });
    expect(next.fields.city).toBe('York');
    expect(next.lists.life_hacks.map((r) => r.key)).toEqual(['i-tip', 'id-1']);
    expect(next.baseUpdatedAt).toBe(NEXT_AT);
  });

  test('editorShellReducer passes other actions to editorReducer', () => {
    const base = initialEditorState(loaded());
    expect(editorShellReducer(base, { type: 'setField', field: 'city', value: 'York' }).fields.city).toBe('York');
  });
});

describe('error visibility', () => {
  const errors = { 'profile.headline': 'Too long', 'new:a.title': 'Title is required.' };

  test('nothing shows before a blur or a save attempt', () => {
    expect(visibleErrors(errors, new Set(), false)).toEqual({});
  });

  test('after a save attempt every error shows', () => {
    expect(visibleErrors(errors, new Set(), true)).toEqual(errors);
  });

  test('a blur shows the errors present at that moment, not later ones', () => {
    const touched = touchErrors(new Set(), { 'profile.headline': 'Too long' });
    expect(visibleErrors(errors, touched, false)).toEqual({ 'profile.headline': 'Too long' });
  });

  test('a server error wins over a shown validation error on the same key', () => {
    expect(visibleErrors(errors, new Set(), true, { 'profile.headline': 'Server says no' })).toEqual({
      'profile.headline': 'Server says no',
      'new:a.title': 'Title is required.',
    });
  });

  test('server field errors always show and win', () => {
    expect(visibleErrors(errors, new Set(), false, { 'profile.headline': 'Server says no' })).toEqual({
      'profile.headline': 'Server says no',
    });
  });
});

describe('publish blockers', () => {
  test('each blocker links to its field, all at once, in order', () => {
    expect(publishBlockers(['Add a profile photo', 'Add a display name', 'Choose a CheckLyra ID'])).toEqual([
      { message: 'Add a profile photo', fieldId: 'profile-photo', errorKey: 'photo' },
      { message: 'Add a display name', fieldId: 'profile-display_name', errorKey: 'profile.display_name' },
      { message: 'Choose a CheckLyra ID', fieldId: 'profile-lyra_id', errorKey: 'profile.lyra_id' },
    ]);
  });

  test('an unknown message has no target', () => {
    expect(publishBlockers(['Something else'])).toEqual([{ message: 'Something else', fieldId: null, errorKey: null }]);
  });

  test('blockers as field errors', () => {
    expect(publishBlockerErrors(['Add a display name'])).toEqual({ 'profile.display_name': 'Add a display name' });
  });
});

describe('Save Changes enablement', () => {
  const base = initialEditorState(loaded());
  test('disabled when not dirty', () => {
    expect(saveChangesDisabled(base, false, false)).toBe(true);
  });
  test('enabled when dirty', () => {
    expect(saveChangesDisabled(base, true, false)).toBe(false);
  });
  test('disabled while the photo is removed, even when dirty', () => {
    const removed = run(base, { type: 'requestPhotoRemoval' });
    expect(removed.photo.kind).toBe('removed');
    expect(saveChangesDisabled(removed, true, false)).toBe(true);
  });
  test('disabled while saving', () => {
    expect(saveChangesDisabled(base, true, true)).toBe(true);
  });
});

describe('unsaved-changes link guard', () => {
  const here = 'https://checklyra.com/dashboard/profile';
  const click = (over: Partial<Parameters<typeof shouldGuardLinkClick>[0]>) =>
    shouldGuardLinkClick({ href: 'https://checklyra.com/dashboard', target: '', download: false, modified: false, currentHref: here, ...over });

  test('an in-app link in the same tab is guarded', () => {
    expect(click({})).toBe(true);
  });
  test('_self is guarded', () => {
    expect(click({ target: '_self' })).toBe(true);
  });
  test('a table-of-contents hash link is not guarded', () => {
    expect(click({ href: 'https://checklyra.com/dashboard/profile#gifts' })).toBe(false);
  });
  test('a new-tab link is not guarded', () => {
    expect(click({ target: '_blank' })).toBe(false);
  });
  test('modified clicks and downloads are not guarded', () => {
    expect(click({ modified: true })).toBe(false);
    expect(click({ download: true })).toBe(false);
  });
  test('off-site links are left to beforeunload', () => {
    expect(click({ href: 'https://example.com/' })).toBe(false);
  });
  test('a link to another path with a hash is guarded', () => {
    expect(click({ href: 'https://checklyra.com/dashboard#top' })).toBe(true);
  });
});

describe('draft CheckLyra ID warning', () => {
  test("'taken' becomes the approved copy", () => {
    expect(lyraIdWarningMessage('taken')).toBe('That CheckLyra ID is already taken.');
  });
  test('a validator message passes through', () => {
    expect(lyraIdWarningMessage('Use 3–30 characters.')).toBe('Use 3–30 characters.');
  });
  test('no warning → null', () => {
    expect(lyraIdWarningMessage(undefined)).toBeNull();
    expect(lyraIdWarningMessage('')).toBeNull();
  });
});

// ── KAN-487 PR2 review fixes ─────────────────────────────────────────────

describe('PR2 review Major 1: "Try again" after a failed Publish retries the PUBLISH', () => {
  test('a failed publish is remembered as a publish until a save completes', () => {
    expect(failedIntentAfter('publish', false)).toBe('publish');
    expect(failedIntentAfter('publish', true)).toBeNull();
    expect(failedIntentAfter('draft', false)).toBe('draft');
  });

  test('the retry runs the failed intent, even on an unpublished profile', () => {
    expect(retryIntent('publish', false)).toBe('publish');
    expect(retryIntent('draft', false)).toBe('draft');
    expect(retryIntent('published', true)).toBe('published');
  });

  test('with no failed save the retry is the bar’s own save', () => {
    expect(retryIntent(null, false)).toBe('draft');
    expect(retryIntent(null, true)).toBe('published');
  });

  test('save step went through, publish failed: the retry re-sends only the publish, against the fresh baseline', () => {
    const base = initialEditorState(loaded({ is_published: false, first_published_at: null }));
    const sent = run(base, { type: 'addRow', listKey: 'life_hacks', key: 'new:p1' }, {
      type: 'updateRow',
      listKey: 'life_hacks',
      key: 'new:p1',
      patch: { title: 'Meal plan' },
    });
    // The publish result's `saved`: rows stored, profile still unpublished.
    const saved = { ...ok(), isPublished: false, firstPublishedAt: null };
    const { baseline, live } = rebaseAfterSave(sent, sent, { 'new:p1': 'id-p1' }, saved);
    const intent = retryIntent(failedIntentAfter('publish', false), live.isPublished);
    expect(intent).toBe('publish');
    expect(buildSavePayload(baseline, live, MODE_FOR_INTENT[intent])).toEqual({
      base_updated_at: '2026-11-23T10:05:00.000Z',
    });
    expect(MODE_FOR_INTENT[intent]).toBe('publish');
  });
});

describe('PR2 review Major 2: the server’s message and Reload', () => {
  test('the server message is shown beneath the generic copy, with Try again', () => {
    expect(saveFailureStatus('Too many changes in a short time. Please wait a minute.')).toEqual({
      detail: 'Too many changes in a short time. Please wait a minute.',
      action: 'retry',
    });
  });

  test('"Editor is out of date" offers Reload, not Try again', () => {
    expect(saveFailureStatus('Editor is out of date. Reload to continue.')).toEqual({
      detail: 'Editor is out of date. Reload to continue.',
      action: 'reload',
    });
  });

  test('"saved somewhere else" offers Reload', () => {
    expect(saveFailureStatus('Your profile was saved somewhere else. Reload to see the latest version.')).toEqual({
      detail: 'Your profile was saved somewhere else. Reload to see the latest version.',
      action: 'reload',
    });
  });

  test('the generic copy itself (or nothing) adds no second line', () => {
    expect(saveFailureStatus('We couldn’t save your changes. Your edits are still here.')).toEqual({
      detail: null,
      action: 'retry',
    });
    expect(saveFailureStatus(undefined)).toEqual({ detail: null, action: 'retry' });
  });

  test('isReloadError matches the word "Reload" only', () => {
    expect(isReloadError('Some entries no longer exist. Reload to see your latest profile.')).toBe(true);
    expect(isReloadError('Reloading is not a word we use')).toBe(false);
    expect(isReloadError('Add a display name')).toBe(false);
  });
});

describe('PR2 review Major 3: Back / Forward guard', () => {
  test('a dirty editor pushes the sentinel once', () => {
    expect(historyGuardStep({ dirty: true, onSentinel: false, leaving: false })).toBe('push');
    expect(historyGuardStep({ dirty: true, onSentinel: true, leaving: false })).toBe('none');
  });

  test('a clean editor pops its sentinel', () => {
    expect(historyGuardStep({ dirty: false, onSentinel: true, leaving: false })).toBe('pop');
    expect(historyGuardStep({ dirty: false, onSentinel: false, leaving: false })).toBe('none');
  });

  test('nothing while the member is leaving', () => {
    expect(historyGuardStep({ dirty: true, onSentinel: false, leaving: true })).toBe('none');
    expect(historyGuardStep({ dirty: false, onSentinel: true, leaving: true })).toBe('none');
  });

  test('Back off the sentinel while dirty asks', () => {
    expect(popstateStep({ dirty: true, landedOnSentinel: false, leaving: false, ignoreNext: false })).toBe('confirm');
  });

  test('landing on a sentinel, a clean editor, our own pop, or a confirmed leave does not ask', () => {
    expect(popstateStep({ dirty: true, landedOnSentinel: true, leaving: false, ignoreNext: false })).toBe('ignore');
    expect(popstateStep({ dirty: false, landedOnSentinel: false, leaving: false, ignoreNext: false })).toBe('ignore');
    expect(popstateStep({ dirty: true, landedOnSentinel: false, leaving: false, ignoreNext: true })).toBe('ignore');
    expect(popstateStep({ dirty: true, landedOnSentinel: false, leaving: true, ignoreNext: false })).toBe('ignore');
  });

  test('OK leaves, Cancel stays (re-push)', () => {
    expect(afterBackConfirm(true)).toBe('leave');
    expect(afterBackConfirm(false)).toBe('stay');
  });

  test('the sentinel is recognised by its marker only', () => {
    expect(isGuardState({ __lyraEditorGuard: true, __NA: true })).toBe(true);
    expect(isGuardState({ __NA: true })).toBe(false);
    expect(isGuardState(null)).toBe(false);
    expect(isGuardState({ __lyraEditorGuard: 'yes' })).toBe(false);
  });
});

describe('PR2 review minor: a blur touches only the field left', () => {
  const errors = {
    'profile.headline': 'Too long',
    'profile.display_name': 'Add a display name',
    'new:a.title': 'Title is required.',
    'new:a.description': 'Too long',
    'i-1.answer': 'Too long',
    'q2.custom_prompt': 'Add a question',
    'manual_of_me.boundaries': 'Too long',
    photo: 'Add a profile photo',
  };

  test('profile fields', () => {
    expect(errorKeysForFieldId('profile-headline', Object.keys(errors))).toEqual(['profile.headline']);
    expect(errorKeysForFieldId('profile-photo', Object.keys(errors))).toEqual(['photo']);
  });

  test('a row field (new key made DOM-safe)', () => {
    expect(domSafeKey('new:a')).toBe('new_a');
    expect(errorKeysForFieldId('list-life_hacks-new_a-title', Object.keys(errors))).toEqual(['new:a.title']);
    expect(errorKeysForFieldId('list-life_hacks-new_a-description', Object.keys(errors))).toEqual(['new:a.description']);
  });

  test('question answer / custom prompt and §05 prompts', () => {
    expect(errorKeysForFieldId('q-i-1-answer', Object.keys(errors))).toEqual(['i-1.answer']);
    expect(errorKeysForFieldId('qc-q2-prompt', Object.keys(errors))).toEqual(['q2.custom_prompt']);
    expect(errorKeysForFieldId('understand-boundaries', Object.keys(errors))).toEqual(['manual_of_me.boundaries']);
  });

  test('touchField adds the blurred field only', () => {
    const touched = touchField(new Set(), 'profile-headline', errors);
    expect([...touched]).toEqual(['profile.headline']);
    expect(visibleErrors(errors, touched, false)).toEqual({ 'profile.headline': 'Too long' });
  });

  test('a field with no error leaves touched unchanged', () => {
    const before = new Set(['profile.headline']);
    expect(touchField(before, 'profile-city', errors)).toBe(before);
  });
});

describe('PR2 review minor: a server field error clears once its field changes', () => {
  test('editing the field drops its server error; other server errors stay', () => {
    const base = initialEditorState(loaded());
    const server = { 'profile.headline': 'Remove contact details', 'profile.city': 'Remove contact details' };
    const live = run(base, { type: 'setField', field: 'headline', value: 'Engineer and baker' });
    expect(liveServerErrors(server, base, live)).toEqual({ 'profile.city': 'Remove contact details' });
  });

  test('an unchanged field keeps its server error', () => {
    const base = initialEditorState(loaded());
    expect(liveServerErrors({ 'profile.headline': 'Remove contact details' }, base, base)).toEqual({
      'profile.headline': 'Remove contact details',
    });
  });

  test('a row field: editing that row’s title clears `<key>.title`, not its description error', () => {
    const base = initialEditorState(loaded());
    const server = { 'i-tip.title': 'Remove contact details', 'i-tip.description': 'Remove contact details' };
    const live = run(base, { type: 'updateRow', listKey: 'life_hacks', key: 'i-tip', patch: { title: 'Batch cook!' } });
    expect(liveServerErrors(server, base, live)).toEqual({ 'i-tip.description': 'Remove contact details' });
  });

  test('a new photo clears the photo error', () => {
    const base = initialEditorState(loaded());
    const live = run(base, { type: 'setPhoto', photo: { kind: 'staged', path: 'u/staged-1.jpg', previewUrl: 'blob:x' } });
    expect(liveServerErrors({ photo: 'Add a profile photo' }, base, live)).toEqual({});
  });

  test('not captured yet (base null) → every server error shows', () => {
    const base = initialEditorState(loaded());
    expect(liveServerErrors({ 'profile.headline': 'x' }, null, base)).toEqual({ 'profile.headline': 'x' });
  });
});

describe('PR2 review minor: rows keep their expanded state across a save', () => {
  test('a saved new key is replaced by its stored id', () => {
    expect([...remapKeySet(new Set(['new:a', 'i-1']), { 'new:a': 'id-a' })]).toEqual(['id-a', 'i-1']);
  });

  test('nothing to map → the same set', () => {
    const s = new Set(['i-1']);
    expect(remapKeySet(s, { 'new:z': 'id-z' })).toBe(s);
  });
});
