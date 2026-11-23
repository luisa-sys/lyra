/**
 * KAN-488 — the public profile loader (spec v0.8 §1, §02, §03, §3).
 *
 * Behavioural: the real loader runs against the per-statement Supabase mock,
 * whose fixture rows are filtered by each statement's OWN `.eq()` / `.in()`
 * calls. Dropping a filter from the loader therefore lets the secret row
 * through to the output, not merely changes a recorded call.
 *
 * Expected values are literals written here, never derived from the module
 * under test (CLAUDE.md failure mode 10).
 */

const mockState: { rows: Record<string, Array<Record<string, unknown>>>; errorTable: string | null } = {
  rows: {},
  errorTable: null,
};

jest.mock('@/modules/platform/supabase-service', () => {
  const harness = require('../support/supabase-statement-mock');
  return {
    createServiceRoleClient: () =>
      harness.createStatementMockClient({
        getUserId: () => null,
        rows: (table: string) => mockState.rows[table],
        error: (table: string) => (table === mockState.errorTable ? { message: 'boom', code: 'XX000' } : null),
      }),
  };
});

const mockCaptureException = jest.fn();
jest.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

import { statementLog, onlyStatement } from '../support/supabase-statement-mock';
import { aliceProfileRow, aliceRows, SECRET_TOKENS } from '../support/kan488-public-profile-fixture';
import {
  loadPublicProfile,
  loadPublicProfileRow,
  type PublicProfileRow,
} from '@/modules/public-profile/load-public-profile';
import { initialEditorState } from '@/modules/profile/editor/editor-state';
import { buildPublicProfileView } from '@/modules/profile/editor/public-view-model';

beforeEach(() => {
  statementLog.reset();
  mockCaptureException.mockReset();
  mockState.rows = aliceRows();
  mockState.errorTable = null;
});

async function loadAlice(isAuthenticated: boolean) {
  const row = await loadPublicProfileRow('alice');
  expect(row).not.toBeNull();
  return loadPublicProfile(row as PublicProfileRow, { isAuthenticated });
}

function allText(loaded: Awaited<ReturnType<typeof loadAlice>>): string {
  return JSON.stringify([loaded.items, loaded.schools]);
}

describe('KAN-488 loader — query filters (statement level)', () => {
  test('profile_items read asks only for approved user/ai rows in the v0.8 categories, in stored order', async () => {
    await loadAlice(false);
    const items = onlyStatement('profile_items', 'select');
    expect(items.eq).toContainEqual(['profile_id', 'p-alice']);
    expect(items.eq).toContainEqual(['approved', true]);
    const byCol = new Map(items.in.map(([col, values]) => [col, values]));
    expect(byCol.get('origin')).toEqual(['user', 'ai']);
    // Written out here, not imported: the 15 categories the v0.8 editor shows.
    expect(new Set(byCol.get('category'))).toEqual(
      new Set([
        'causes',
        'proud_of',
        'gift_ideas',
        'gifts_to_avoid',
        'quotes',
        'favourite_media',
        'plays',
        'favourite_tv',
        'favourite_books',
        'favourite_places',
        'favourite_venues',
        'favourite_custom',
        'favourite_music',
        'life_hacks',
        'current_problems',
      ]),
    );
    expect(byCol.get('category')).toHaveLength(15);
    expect(items.order).toEqual(['sort_order', 'created_at']);
  });

  test('school_affiliations read asks only for rows the owner opted in', async () => {
    await loadAlice(false);
    const schools = onlyStatement('school_affiliations', 'select');
    expect(schools.eq).toContainEqual(['profile_id', 'p-alice']);
    expect(schools.eq).toContainEqual(['show_on_profile', true]);
  });

  test('profile row comes from the public_profiles view by slug', async () => {
    await loadAlice(false);
    const view = onlyStatement('public_profiles', 'select');
    expect(view.eq).toEqual([['slug', 'alice']]);
    expect(view.columns).toBe('*');
  });

  test('reads exactly these five tables — no profiles base table, links or dismissals', async () => {
    await loadAlice(false);
    expect(new Set(statementLog.all.map((s) => s.table))).toEqual(
      new Set([
        'public_profiles',
        'profile_items',
        'school_affiliations',
        'profile_manual_of_me',
        'profile_conversation_starters',
      ]),
    );
  });
});

describe('KAN-488 loader — output', () => {
  test('anonymous viewer: no secret, legacy or members-only content, other profile rows excluded', async () => {
    const loaded = await loadAlice(false);
    const text = allText(loaded);
    for (const token of SECRET_TOKENS) expect(text).not.toContain(token);
    expect(text).not.toContain('OTHER-PROFILE-GIFT');
    expect(loaded.items.map((i) => i.title)).toEqual([
      'Clean rivers',
      'Ran a marathon',
      'Pottery class',
      'Kite kit',
      'Perfume',
      'Stay curious',
      'Middlemarch',
      'Batch cooking',
      'Finding a plumber',
    ]);
    expect(loaded.schools.map((s) => s.school_name)).toEqual(['Hillside Choir']);
  });

  test('signed-in viewer additionally sees the members-only tip, and nothing else secret', async () => {
    const loaded = await loadAlice(true);
    const text = allText(loaded);
    expect(text).toContain('MEMBERS-ONLY-TIP');
    expect(text).not.toContain('SECRET-AI-GIFT');
    expect(text).not.toContain('SECRET-SCHOOL');
    expect(text).not.toContain('LEGACY-DISLIKE');
  });

  test('answers: preset wording from the joined prompt, custom question kept', async () => {
    const loaded = await loadAlice(false);
    expect(loaded.conversationAnswers.map((a) => [a.prompt, a.answer])).toEqual([
      ['Who you’d invite for a dinner party, dead or alive?', 'Ada Lovelace'],
      ['Favourite tool?', 'A good pen\nand paper'],
    ]);
    expect(loaded.conversationPrompts.map((p) => [p.id, p.sort_order])).toEqual([['q-dinner', 1]]);
  });

  test('a legacy row with slug_confirmed false still shows its ID', async () => {
    mockState.rows = aliceRows({ public_profiles: [aliceProfileRow({ slug_confirmed: false })] });
    const loaded = await loadAlice(false);
    expect(initialEditorState(loaded).lyraId).toBe('alice');
  });

  test('a view row without a billboard key (pre-migration) produces no billboard section', async () => {
    const row = aliceProfileRow();
    delete row.billboard;
    mockState.rows = aliceRows({ public_profiles: [row] });
    const loaded = await loadAlice(false);
    expect(loaded.profile.billboard).toBeNull();
    const ids = buildPublicProfileView(initialEditorState(loaded), { audience: 'public' }).sections.map((s) => s.id);
    expect(ids).not.toContain('billboard');
    expect(ids).toContain('about');
  });
});

describe('KAN-488 loader — not found and failures', () => {
  test('unknown slug returns null', async () => {
    await expect(loadPublicProfileRow('nobody')).resolves.toBeNull();
  });

  test('an items read error throws and is reported to Sentry once', async () => {
    mockState.errorTable = 'profile_items';
    const row = (await loadPublicProfileRow('alice')) as PublicProfileRow;
    await expect(loadPublicProfile(row, { isAuthenticated: false })).rejects.toThrow(
      'Public profile section reads failed for profile_items',
    );
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockCaptureException.mock.calls[0][1]).toEqual({
      tags: { area: 'public-profile', table: 'profile_items' },
      extra: { slug: 'alice', profileId: 'p-alice' },
    });
  });
});
