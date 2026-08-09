/**
 * BUGS-70 (KAN-271) — a Manual-of-Me edit must reliably persist to
 * profile_manual_of_me and render on the published profile.
 *
 * Root cause (verified 2026-07-24/25): the MoMField textareas in
 * manual-of-me-section.tsx had no onBlur handler, so blurring a field never
 * flushed the debounced autosave. The authed E2E (journey.authed.spec.ts:97)
 * fills a box, blurs, then immediately navigates to the public profile — the
 * navigation unmounts the section (cancelling the 800ms debounce timer) and
 * aborts the in-flight server action, so the edit never reached the DB.
 *
 * The DB write path itself was already correct: updateManualOfMe upserts
 * (INSERT ... ON CONFLICT (profile_id) DO UPDATE), so a first-time edit with no
 * existing row INSERTs rather than no-oping, and RLS permits the owner's write
 * (reproduced directly against dev). This file guards BOTH halves:
 *   1. Action-level persistence — upsert (not a plain update) + a real DB error
 *      is surfaced (the "Saved" toast reflects persistence, it is not optimistic).
 *   2. The fix — every Manual-of-Me field flushes the pending save on blur.
 */

// --- Mocks --------------------------------------------------------------

const mockRevalidatePath = jest.fn();
jest.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

const mockUpsert = jest.fn();
const mockGetUser = jest.fn();
const mockProfileSelectSingle = jest.fn();

jest.mock('@/modules/platform/supabase-server', () => ({
  createClient: jest.fn().mockImplementation(async () => ({
    auth: { getUser: mockGetUser },
    from: jest.fn().mockImplementation((table: string) => {
      if (table === 'profiles') {
        return { select: () => ({ eq: () => ({ single: mockProfileSelectSingle }) }) };
      }
      if (table === 'profile_manual_of_me') {
        return {
          // Only `upsert` is defined on purpose. If the action ever regressed
          // to a plain `.update()` — which affects 0 rows when no row exists yet
          // (a BUGS-70-class silent-no-op) — this mock would throw
          // "upsert/update is not a function" and fail loudly.
          upsert: (data: unknown, opts: unknown) => Promise.resolve(mockUpsert(data, opts)),
        };
      }
      if (table === 'content_moderation_flags') {
        // moderateAndAudit fire-and-forgets an audit row on block/warn.
        return { insert: () => Promise.resolve({ error: null }) };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    }),
  })),
}));

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { updateManualOfMe } from '@/app/dashboard/profile/manual-of-me-actions';

beforeEach(() => {
  mockRevalidatePath.mockClear();
  mockGetUser.mockReset();
  mockProfileSelectSingle.mockReset();
  mockUpsert.mockReset();
  // Default: authed user + their profile exists + a clean write.
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  mockProfileSelectSingle.mockResolvedValue({ data: { id: 'profile-1' }, error: null });
  mockUpsert.mockReturnValue({ error: null });
});

// --- 1. Action-level persistence ---------------------------------------

describe('BUGS-70: updateManualOfMe persistence', () => {
  test('a first-time edit with NO existing row still persists (upsert, not a no-op update)', async () => {
    // A clean, human-readable marker (no long digit run) so this exercises the
    // PERSISTENCE path, not the PII filter. See the moderation-collision test
    // below for why the E2E's numeric `Date.now()` marker never gets this far.
    const marker = 'E2E manual note about slow texting';
    const result = await updateManualOfMe({ good_to_know: marker });

    expect(result).toEqual({ success: true });
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const [payload, opts] = mockUpsert.mock.calls[0];
    // The owning profile_id is resolved server-side and the value is written.
    expect(payload).toEqual({ profile_id: 'profile-1', good_to_know: marker });
    // onConflict makes it INSERT-or-UPDATE — the key property that lets a first
    // edit land when profile_manual_of_me has 0 rows for the profile.
    expect(opts).toEqual({ onConflict: 'profile_id' });
    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard/profile');
  });

  test('a DB write failure is surfaced as { success:false } and does NOT revalidate (the toast reflects real persistence, not an optimistic no-op)', async () => {
    mockUpsert.mockReturnValueOnce({
      error: { message: 'new row violates row-level security policy for table "profile_manual_of_me"' },
    });

    const result = await updateManualOfMe({ good_to_know: 'anything' });

    expect(result.success).toBe(false);
    if (!result.success) {
      // BUGS-87: this asserted the member is shown 'row-level security policy
      // for table "profile_manual_of_me"'. This test's stated intent is that a
      // failed write is surfaced and NOT revalidated — that is untouched. What
      // changes is that the member no longer reads the database's internals.
      expect(result.error).toBe('Something went wrong saving that. Please try again.');
      expect(result.error).not.toMatch(/row-level security/i);
    }
    // No false "Saved": the save path never claims success on a failed write,
    // and it must not revalidate a page whose data did not change.
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  // ── Co-root-cause tripwire ────────────────────────────────────────────
  // The authed E2E (journey.authed.spec.ts:101) uses the marker
  // `E2E manual note ${Date.now()}`. Date.now() is a 13-digit run, which the
  // PII filter flags as `pii:phone_plain` (content-moderation.ts:307, a
  // DELIBERATE, separately-tested control — content-moderation.test.ts:197).
  // On a public field that is severity=block, so updateManualOfMe rejects the
  // save BEFORE any write — the row never lands, independent of the blur fix.
  //
  // This test PINS that behaviour. It is intentionally NOT "fixed" here:
  // relaxing the phone filter would weaken PII-leak prevention on a service
  // holding minors' data (needs founder/security sign-off), and the E2E marker
  // must not be changed without sign-off (Test Integrity Policy — it is the
  // `getByText(marker)` locator). If either changes, this test should be
  // updated deliberately, as a signal that the decision was made.
  test('DOCUMENTS co-root-cause: the numeric E2E marker is blocked by PII moderation before it can persist', async () => {
    const numericMarker = `E2E manual note ${Date.now()}`;
    const result = await updateManualOfMe({ good_to_know: numericMarker });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/personal information/i);
    }
    // The block happens up-front — no DB write is attempted.
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

// --- 2. The fix: flush the pending save on blur ------------------------

describe('BUGS-70: Manual-of-Me fields flush the pending autosave on blur', () => {
  const SECTION = resolve(
    __dirname,
    '../../src/app/dashboard/profile/sections/manual-of-me-section.tsx',
  );
  const src = readFileSync(SECTION, 'utf-8');

  test('flush is sourced from useAutoSave', () => {
    expect(src).toMatch(/const\s*\{\s*status,\s*flush\s*\}\s*=\s*useAutoSave/);
  });

  test('every one of the six Manual-of-Me fields wires onBlur={flush}', () => {
    // Rendering the hook needs a DOM env the repo's node jest config doesn't
    // provide (see auto-save-flush.test.ts), so assert the wiring at source —
    // one onBlur={flush} per MoMField so blurring ANY box flushes the save.
    const count = (src.match(/onBlur=\{flush\}/g) || []).length;
    expect(count).toBe(6);
  });

  test('MoMField forwards its onBlur prop to the underlying <textarea>', () => {
    expect(src).toMatch(/onBlur\?:\s*\(\)\s*=>\s*void/);
    expect(src).toMatch(/<textarea[\s\S]*?onBlur=\{onBlur\}/);
  });
});
