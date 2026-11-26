/**
 * KAN-489 — AI suggestions in the editor state: the reducer actions
 * `aiGiftsGenerated` / `aiGiftDismissed`, the baseline helpers in
 * editor-shell.ts, and their effect on the save diff (spec v0.8 §03 "Each
 * suggestion can be individually approved or deleted… Deleting a suggestion
 * dismisses only that item").
 *
 * Behavioural, through the real `initialEditorState`, `editorReducer`,
 * `buildSavePayload` / `isDirty`. Expected values are literals.
 */
import { editorReducer } from '@/modules/profile/editor/editor-reducer';
import { buildSavePayload, isDirty } from '@/modules/profile/editor/editor-diff';
import {
  applyAiGiftChangeToBaseline,
  replayAiGiftChanges,
  savedApprovedAiGiftIds,
} from '@/modules/profile/editor/editor-shell';
import { initialEditorState, type EditorState, type LoadedItem, type LoadedProfile } from '@/modules/profile/editor/editor-state';

const PID = '00000000-0000-4000-8000-000000000001';

function item(over: Partial<LoadedItem> & Pick<LoadedItem, 'id' | 'category'>): LoadedItem {
  return { title: `title ${over.id}`, description: null, url: null, group_label: null, origin: 'user', approved: true, ...over };
}

function base(): EditorState {
  const l: LoadedProfile = {
    profile: {
      id: PID,
      display_name: 'Ada',
      slug: 'ada_l',
      slug_confirmed: true,
      first_published_at: '2026-11-01T00:00:00.000Z',
      is_published: true,
      avatar_url: 'https://cdn.example/a.jpg',
      headline: 'Engineer',
      city: null,
      country: null,
      bio_short: null,
      gift_voucher_hint: null,
      billboard: null,
      updated_at: '2026-11-23T10:00:00.000Z',
    },
    items: [
      item({ id: 'g-1', category: 'gift_ideas', title: 'Tea' }),
      item({ id: 'ai-ok', category: 'gift_ideas', origin: 'ai', approved: true, title: 'Approved AI' }),
      item({ id: 'ai-wait', category: 'gift_ideas', origin: 'ai', approved: false, title: 'Pending AI' }),
    ],
    schools: [],
    manualOfMe: null,
    conversationPrompts: [],
    conversationAnswers: [],
  };
  return initialEditorState(l);
}

const NEW_ROWS = [
  { id: 'new-1', title: 'Kite', description: 'Fly it' },
  { id: 'new-2', title: 'Clay', description: null },
];

describe('aiGiftsGenerated', () => {
  it('appends the new rows as unapproved, with empty url and description fallback', () => {
    const s = editorReducer(base(), { type: 'aiGiftsGenerated', rows: NEW_ROWS });
    expect(s.aiGifts).toEqual([
      { id: 'ai-ok', title: 'Approved AI', description: '', url: '', approved: true },
      { id: 'ai-wait', title: 'Pending AI', description: '', url: '', approved: false },
      { id: 'new-1', title: 'Kite', description: 'Fly it', url: '', approved: false },
      { id: 'new-2', title: 'Clay', description: '', url: '', approved: false },
    ]);
  });

  it('skips ids already present; nothing new returns the SAME state', () => {
    const b = base();
    expect(editorReducer(b, { type: 'aiGiftsGenerated', rows: [{ id: 'ai-wait', title: 'Changed', description: null }] })).toBe(b);
  });

  it('never touches the member’s own gifts', () => {
    const b = base();
    const s = editorReducer(b, { type: 'aiGiftsGenerated', rows: NEW_ROWS });
    expect(s.lists.gift_ideas).toBe(b.lists.gift_ideas);
  });

  it('with the same change applied to the baseline, the editor stays NOT dirty', () => {
    const b = base();
    const change = { type: 'aiGiftsGenerated' as const, rows: NEW_ROWS };
    const live = editorReducer(b, change);
    const baseline = applyAiGiftChangeToBaseline(b, change);
    expect(isDirty(baseline, live)).toBe(false);
  });

  it('approving a generated row is sent as ai_gifts.approve — but only when the baseline was updated', () => {
    const b = base();
    const change = { type: 'aiGiftsGenerated' as const, rows: NEW_ROWS };
    const live = editorReducer(editorReducer(b, change), { type: 'approveAiGift', id: 'new-1' });

    const withBaseline = buildSavePayload(applyAiGiftChangeToBaseline(b, change), live, 'published');
    expect(withBaseline.ai_gifts).toEqual({ approve: ['new-1'], delete: [] });

    // Without the baseline update the approval silently vanishes from the diff.
    const stale = buildSavePayload(b, live, 'published');
    expect(stale.ai_gifts).toBeUndefined();
  });
});

describe('aiGiftDismissed', () => {
  it('removes exactly the one row', () => {
    const s = editorReducer(base(), { type: 'aiGiftDismissed', id: 'ai-wait' });
    expect(s.aiGifts.map((g) => g.id)).toEqual(['ai-ok']);
  });

  it('with several pending rows, only the named one goes (neighbours untouched)', () => {
    const withNew = editorReducer(base(), { type: 'aiGiftsGenerated', rows: NEW_ROWS });
    const s = editorReducer(withNew, { type: 'aiGiftDismissed', id: 'new-1' });
    expect(s.aiGifts.map((g) => g.id)).toEqual(['ai-ok', 'ai-wait', 'new-2']);
  });

  it('an unknown id returns the SAME state', () => {
    const b = base();
    expect(editorReducer(b, { type: 'aiGiftDismissed', id: 'nope' })).toBe(b);
  });

  it('applied to the baseline too, the dismissal is NOT sent again as ai_gifts.delete', () => {
    const b = base();
    const change = { type: 'aiGiftDismissed' as const, id: 'ai-wait' };
    const live = editorReducer(b, change);
    expect(buildSavePayload(applyAiGiftChangeToBaseline(b, change), live, 'published').ai_gifts).toBeUndefined();
    // Against the old baseline it would be re-sent (and fail: the row is gone).
    expect(buildSavePayload(b, live, 'published').ai_gifts).toEqual({ approve: [], delete: ['ai-wait'] });
  });

  it('approved rows survive dismissing a pending one', () => {
    const s = editorReducer(base(), { type: 'aiGiftDismissed', id: 'ai-wait' });
    expect(s.aiGifts).toEqual([{ id: 'ai-ok', title: 'Approved AI', description: '', url: '', approved: true }]);
  });
});

describe('replayAiGiftChanges — a generation during an in-flight save', () => {
  it('re-applies only the changes after the save started, keeping the new row approvable', () => {
    const b = base();
    const earlier = { type: 'aiGiftDismissed' as const, id: 'ai-wait' };
    const during = { type: 'aiGiftsGenerated' as const, rows: [NEW_ROWS[0]] };
    // The snapshot sent with the save already had `earlier` applied.
    const sent = editorReducer(b, earlier);
    const newBaseline = replayAiGiftChanges(sent, [during]);
    expect(newBaseline.aiGifts.map((g) => g.id)).toEqual(['ai-ok', 'new-1']);
    const live = editorReducer(editorReducer(editorReducer(b, earlier), during), { type: 'approveAiGift', id: 'new-1' });
    expect(buildSavePayload(newBaseline, live, 'published').ai_gifts).toEqual({ approve: ['new-1'], delete: [] });
  });

  it('no changes → the same baseline object', () => {
    const b = base();
    expect(replayAiGiftChanges(b, [])).toBe(b);
  });
});

describe('savedApprovedAiGiftIds', () => {
  it('lists only the approved AI rows of the baseline', () => {
    const b = editorReducer(base(), { type: 'aiGiftsGenerated', rows: NEW_ROWS });
    expect([...savedApprovedAiGiftIds(b)]).toEqual(['ai-ok']);
  });
});
