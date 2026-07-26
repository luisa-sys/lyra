/**
 * BUGS-74 — the profile editor silently deleted "Good to know about me" and
 * "My boundaries" whenever any Manual-of-Me field was edited.
 *
 * Root cause: `src/app/dashboard/profile/page.tsx` hand-listed FOUR of the six
 * allowlisted `profile_manual_of_me` columns. `good_to_know` + `boundaries`
 * (added later under KAN-263) were never fetched, so the section seeded them as
 * '' and the autosave — which posts the WHOLE draft — wrote NULL over both.
 * The member saw no error; the text stayed on their public profile (which reads
 * all six) until the next page load, by which point the DB value was gone.
 *
 * Two independent guards, because either alone would have stopped this:
 *
 *   1. LOADER-vs-ALLOWLIST DRIFT — every query against profile_manual_of_me
 *      must cover every entry in MANUAL_OF_ME_FIELDS. Deriving the select from
 *      the shared constant satisfies this permanently; a hand-listed subset
 *      fails here. This is the test that would have caught the original bug,
 *      and it will catch the next field added to the allowlist.
 *
 *   2. PARTIAL-SAFE WRITES — "not supplied" (undefined) must never be written
 *      as NULL. Only an explicit null / '' clears a field. This kills the whole
 *      bug class rather than this one instance: even a future caller holding a
 *      partially-loaded row can no longer destroy the columns it never read.
 */

// --- Mocks --------------------------------------------------------------

const mockRevalidatePath = jest.fn();
jest.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

const mockUpsert = jest.fn();
const mockGetUser = jest.fn();
const mockProfileSelectSingle = jest.fn();

jest.mock('@/lib/supabase-server', () => ({
  createClient: jest.fn().mockImplementation(async () => ({
    auth: { getUser: mockGetUser },
    from: jest.fn().mockImplementation((table: string) => {
      if (table === 'profiles') {
        return { select: () => ({ eq: () => ({ single: mockProfileSelectSingle }) }) };
      }
      if (table === 'profile_manual_of_me') {
        return {
          upsert: (data: unknown, opts: unknown) => Promise.resolve(mockUpsert(data, opts)),
        };
      }
      if (table === 'content_moderation_flags') {
        return { insert: () => Promise.resolve({ error: null }) };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    }),
  })),
}));

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { updateManualOfMe } from '@/app/dashboard/profile/manual-of-me-actions';
import { MANUAL_OF_ME_FIELDS } from '@/app/dashboard/profile/manual-of-me-fields';

beforeEach(() => {
  mockRevalidatePath.mockClear();
  mockGetUser.mockReset();
  mockProfileSelectSingle.mockReset();
  mockUpsert.mockReset();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  mockProfileSelectSingle.mockResolvedValue({ data: { id: 'profile-1' }, error: null });
  mockUpsert.mockReturnValue({ error: null });
});

// --- 1. Loader-vs-allowlist drift guard ---------------------------------

/** Extract the `.select(...)` argument of the profile_manual_of_me query. */
function manualOfMeSelectExpr(relPath: string): string {
  const src = readFileSync(resolve(__dirname, '../..', relPath), 'utf-8');
  const block = src.match(/\.from\(\s*['"]profile_manual_of_me['"]\s*\)([\s\S]{0,800}?)\.eq\(/);
  if (!block) {
    throw new Error(
      `${relPath}: no profile_manual_of_me query found. If the query moved, ` +
        `move this guard with it — do not delete it (BUGS-74).`,
    );
  }
  const sel = block[1].match(/\.select\(([^\n]*)\)/);
  if (!sel) throw new Error(`${relPath}: profile_manual_of_me query has no .select(...)`);
  return sel[1];
}

describe('BUGS-74: every profile_manual_of_me loader covers the full allowlist', () => {
  // All three routes that read the table for display. The public profile was
  // always correct and is included as the reference case — if it ever drifts,
  // members' saved text stops rendering publicly.
  const LOADERS = [
    'src/app/dashboard/profile/page.tsx', // the editor — where BUGS-74 lived
    'src/app/dashboard/profile/legacy/page.tsx', // the wizard rollback path — same defect
    'src/app/[slug]/page.tsx', // the public profile — the correct reference
  ];

  test.each(LOADERS)('%s selects every MANUAL_OF_ME_FIELDS column', (relPath) => {
    const expr = manualOfMeSelectExpr(relPath);

    // Deriving the list from the shared constant is drift-proof by construction
    // and is the preferred form. A hand-written literal list is still allowed,
    // but then it must name every allowlisted column.
    const derivesFromAllowlist = /MANUAL_OF_ME_FIELDS/.test(expr);
    const missing = derivesFromAllowlist
      ? []
      : MANUAL_OF_ME_FIELDS.filter((f) => !expr.includes(f));

    // A non-empty list here IS the bug: any column the loader fails to fetch is
    // seeded as '' by the section and written back as NULL on the next edit.
    expect(missing).toEqual([]);
  });

  test('the allowlist still contains the two columns the editor used to drop', () => {
    // Pins the specific regression: if these are ever removed from the
    // allowlist the guard above would pass vacuously.
    expect(MANUAL_OF_ME_FIELDS).toContain('good_to_know');
    expect(MANUAL_OF_ME_FIELDS).toContain('boundaries');
    expect(MANUAL_OF_ME_FIELDS).toHaveLength(6);
  });
});

// --- 2. Partial-safe writes: cleared vs not-supplied ---------------------

describe('BUGS-74: updateManualOfMe never NULLs a field it was not given', () => {
  test('a single-field update does not touch the other five', async () => {
    const result = await updateManualOfMe({ communication_style: 'Direct and brief' });

    expect(result).toEqual({ success: true });
    const [payload] = mockUpsert.mock.calls[0];
    expect(payload).toEqual({ profile_id: 'profile-1', communication_style: 'Direct and brief' });
    // The exact destroy path: these keys must be ABSENT, not null.
    expect(payload).not.toHaveProperty('good_to_know');
    expect(payload).not.toHaveProperty('boundaries');
  });

  test('explicitly-undefined keys are omitted from the payload (the partially-loaded-row case)', async () => {
    // This is precisely what the editor sent before the fix: a draft built from
    // a row that never contained the two columns.
    const result = await updateManualOfMe({
      communication_style: 'Direct and brief',
      good_to_know: undefined,
      boundaries: undefined,
    });

    expect(result).toEqual({ success: true });
    const [payload] = mockUpsert.mock.calls[0];
    expect(payload).not.toHaveProperty('good_to_know');
    expect(payload).not.toHaveProperty('boundaries');
  });

  test('an all-undefined update writes nothing at all', async () => {
    const result = await updateManualOfMe({ good_to_know: undefined, boundaries: undefined });

    expect(result).toEqual({ success: true });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  // --- the other half of the distinction: clearing must still clear ---

  test('an explicit null still clears the field', async () => {
    await updateManualOfMe({ good_to_know: null });

    const [payload] = mockUpsert.mock.calls[0];
    expect(payload).toEqual({ profile_id: 'profile-1', good_to_know: null });
  });

  test('an emptied textarea (empty string) still clears the field', async () => {
    await updateManualOfMe({ boundaries: '' });

    const [payload] = mockUpsert.mock.calls[0];
    expect(payload).toEqual({ profile_id: 'profile-1', boundaries: null });
  });

  test('a whitespace-only textarea still clears the field', async () => {
    await updateManualOfMe({ boundaries: '   ' });

    const [payload] = mockUpsert.mock.calls[0];
    expect(payload).toEqual({ profile_id: 'profile-1', boundaries: null });
  });
});
