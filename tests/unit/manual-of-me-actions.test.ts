/**
 * KAN-154 — updateManualOfMe server action tests.
 *
 * Mirrors the structure of profile-actions.test.ts. Coverage:
 *   - Allowlist enforcement (rejects unknown fields → no DB write)
 *   - sanitiseText is applied (HTML stripped, max-length per field)
 *   - Empty / null inputs are normalised to null in the DB row
 *   - profile_id is resolved server-side from auth.uid() — caller cannot inject
 *   - Auth failure short-circuits before any DB call
 *   - Helper isManualOfMeEmpty correctly detects all-empty rows
 */

// --- Mocks --------------------------------------------------------------

const mockRevalidatePath = jest.fn();
jest.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

// Captures upsert payload + onConflict argument
const mockUpsertCapture = jest.fn();

// Auth + profile-lookup are controllable per-test via these mocks.
const mockGetUser = jest.fn();
const mockProfileSelectSingle = jest.fn();

jest.mock('@/lib/supabase-server', () => ({
  createClient: jest.fn().mockImplementation(async () => ({
    auth: {
      getUser: mockGetUser,
    },
    from: jest.fn().mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              single: mockProfileSelectSingle,
            }),
          }),
        };
      }
      if (table === 'profile_manual_of_me') {
        return {
          upsert: (data: unknown, opts: unknown) => {
            mockUpsertCapture(data, opts);
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    }),
  })),
}));

import { updateManualOfMe } from '@/app/dashboard/profile/manual-of-me-actions';
import {
  MANUAL_OF_ME_FIELDS,
  MANUAL_OF_ME_MAX_LENGTHS,
  isManualOfMeField,
  isManualOfMeEmpty,
} from '@/app/dashboard/profile/manual-of-me-fields';

beforeEach(() => {
  mockUpsertCapture.mockClear();
  mockRevalidatePath.mockClear();
  // Default: authed user + their profile exists
  mockGetUser.mockReset();
  mockProfileSelectSingle.mockReset();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  mockProfileSelectSingle.mockResolvedValue({ data: { id: 'profile-1' }, error: null });
});

// --- Allowlist + sanitisation -------------------------------------------

describe('updateManualOfMe — allowlist + sanitisation', () => {
  test('accepts an allowlisted field and writes the sanitised value', async () => {
    const result = await updateManualOfMe({
      communication_style: 'Async <script>x</script> please',
    });
    expect(result).toEqual({ success: true });
    expect(mockUpsertCapture).toHaveBeenCalledTimes(1);
    const [payload, opts] = mockUpsertCapture.mock.calls[0];
    expect(payload).toEqual({
      profile_id: 'profile-1',
      communication_style: 'Async x please',
    });
    expect(opts).toEqual({ onConflict: 'profile_id' });
    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard/profile');
  });

  test('accepts all four allowlisted fields at once', async () => {
    const result = await updateManualOfMe({
      communication_style: 'Direct',
      working_preferences: 'Mornings',
      energises_me: 'Hard problems',
      drains_me: 'Back-to-back meetings',
    });
    expect(result).toEqual({ success: true });
    const [payload] = mockUpsertCapture.mock.calls[0];
    expect(payload).toMatchObject({
      profile_id: 'profile-1',
      communication_style: 'Direct',
      working_preferences: 'Mornings',
      energises_me: 'Hard problems',
      drains_me: 'Back-to-back meetings',
    });
  });

  test('accepts the two KAN-263 About-me fields (good_to_know + boundaries)', async () => {
    const result = await updateManualOfMe({
      good_to_know: 'I think out loud',
      boundaries: 'Please text before dropping by',
    });
    expect(result).toEqual({ success: true });
    const [payload] = mockUpsertCapture.mock.calls[0];
    expect(payload).toMatchObject({
      profile_id: 'profile-1',
      good_to_know: 'I think out loud',
      boundaries: 'Please text before dropping by',
    });
  });

  test('truncates a too-long working_preferences to MANUAL_OF_ME_MAX_LENGTHS', async () => {
    const long = 'A'.repeat(MANUAL_OF_ME_MAX_LENGTHS.working_preferences + 250);
    await updateManualOfMe({ working_preferences: long });
    const [payload] = mockUpsertCapture.mock.calls[0];
    expect(payload.working_preferences.length).toBe(
      MANUAL_OF_ME_MAX_LENGTHS.working_preferences
    );
  });

  test('truncates a too-long communication_style to its specific limit', async () => {
    const long = 'B'.repeat(MANUAL_OF_ME_MAX_LENGTHS.communication_style + 50);
    await updateManualOfMe({ communication_style: long });
    const [payload] = mockUpsertCapture.mock.calls[0];
    expect(payload.communication_style.length).toBe(
      MANUAL_OF_ME_MAX_LENGTHS.communication_style
    );
  });

  test('REJECTS a non-allowlisted field with a clear error AND no DB write', async () => {
    const result = await updateManualOfMe({
      // Cast through `unknown` to bypass TS — simulates a malicious caller
      // bypassing types. Function must defend at runtime.
      bio_short: 'attack',
    } as unknown as Record<string, string>);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('bio_short');
      expect(result.error).toMatch(/not permitted/i);
    }
    expect(mockUpsertCapture).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  test('REJECTS even a single bad key in an otherwise-valid payload (no partial write)', async () => {
    const result = await updateManualOfMe({
      communication_style: 'OK',
      profile_id: 'attacker-profile',
    } as unknown as Record<string, string>);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('profile_id');
      expect(result.error).not.toContain('communication_style');
    }
    // CRITICAL: no partial DB write of the "OK" field
    expect(mockUpsertCapture).not.toHaveBeenCalled();
  });

  test('REJECTS attempts to inject system columns', async () => {
    for (const dangerous of ['id', 'profile_id', 'created_at', 'updated_at']) {
      mockUpsertCapture.mockClear();
      const result = await updateManualOfMe({
        [dangerous]: 'attacker-value',
      } as unknown as Record<string, string>);
      expect(result.success).toBe(false);
      expect(mockUpsertCapture).not.toHaveBeenCalled();
    }
  });

  test('strips deeply-nested HTML tags (KAN-171 regression guard)', async () => {
    // sanitiseText runs the strip-HTML loop until convergence — confirm a
    // nested-tag bypass is fully neutralised end-to-end via updateManualOfMe.
    // The key property: NO `<` characters survive, so no tag can re-form when
    // the value is rendered as text. (stray `>` characters are harmless once
    // there's no `<` to open a tag.)
    await updateManualOfMe({
      communication_style: '<scr<script>ipt>alert(1)</scr</script>ipt>',
    });
    const [payload] = mockUpsertCapture.mock.calls[0];
    expect(payload.communication_style).not.toContain('<');
    expect(payload.communication_style).not.toContain('<script');
    expect(payload.communication_style).not.toContain('</script');
  });
});

// --- Null / empty handling ----------------------------------------------

describe('updateManualOfMe — null + empty handling', () => {
  test('explicit null is written as null (clears the field)', async () => {
    await updateManualOfMe({ communication_style: null });
    const [payload] = mockUpsertCapture.mock.calls[0];
    expect(payload).toEqual({
      profile_id: 'profile-1',
      communication_style: null,
    });
  });

  test('empty-string input is stored as null (so isManualOfMeEmpty works)', async () => {
    await updateManualOfMe({ drains_me: '   ' }); // whitespace only
    const [payload] = mockUpsertCapture.mock.calls[0];
    expect(payload.drains_me).toBeNull();
  });

  test('empty input object is a no-op success (no DB call)', async () => {
    const result = await updateManualOfMe({});
    expect(result).toEqual({ success: true });
    expect(mockUpsertCapture).not.toHaveBeenCalled();
  });
});

// --- Auth + profile lookup ----------------------------------------------

describe('updateManualOfMe — auth + profile lookup', () => {
  test('returns auth error when there is no user, no DB call', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const result = await updateManualOfMe({ communication_style: 'hi' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/not authenticated/i);
    expect(mockUpsertCapture).not.toHaveBeenCalled();
  });

  test('returns profile-not-found when the profile lookup is empty', async () => {
    mockProfileSelectSingle.mockResolvedValueOnce({ data: null, error: null });
    const result = await updateManualOfMe({ communication_style: 'hi' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/profile not found/i);
    expect(mockUpsertCapture).not.toHaveBeenCalled();
  });
});

// --- Helper assertions on the field metadata ----------------------------

describe('MANUAL_OF_ME_FIELDS + helpers', () => {
  test('exposes the six About-me fields (KAN-263 added good_to_know + boundaries)', () => {
    expect(MANUAL_OF_ME_FIELDS).toEqual([
      'communication_style',
      'working_preferences',
      'energises_me',
      'drains_me',
      'good_to_know',
      'boundaries',
    ]);
  });

  test('every field has a max length set', () => {
    for (const field of MANUAL_OF_ME_FIELDS) {
      expect(typeof MANUAL_OF_ME_MAX_LENGTHS[field]).toBe('number');
      expect(MANUAL_OF_ME_MAX_LENGTHS[field]).toBeGreaterThan(0);
    }
  });

  test('isManualOfMeField guards correctly', () => {
    expect(isManualOfMeField('communication_style')).toBe(true);
    expect(isManualOfMeField('working_preferences')).toBe(true);
    expect(isManualOfMeField('bio_short')).toBe(false);
    expect(isManualOfMeField('profile_id')).toBe(false);
    expect(isManualOfMeField('__proto__')).toBe(false);
  });

  test('isManualOfMeEmpty: true for null', () => {
    expect(isManualOfMeEmpty(null)).toBe(true);
  });

  test('isManualOfMeEmpty: true for all-null row', () => {
    expect(
      isManualOfMeEmpty({
        communication_style: null,
        working_preferences: null,
        energises_me: null,
        drains_me: null,
        good_to_know: null,
        boundaries: null,
      })
    ).toBe(true);
  });

  test('isManualOfMeEmpty: true for all-whitespace row', () => {
    expect(
      isManualOfMeEmpty({
        communication_style: '   ',
        working_preferences: '\n\t',
        energises_me: '',
        drains_me: null,
        good_to_know: '  ',
        boundaries: null,
      })
    ).toBe(true);
  });

  test('isManualOfMeEmpty: false if any field has content', () => {
    expect(
      isManualOfMeEmpty({
        communication_style: 'Direct',
        working_preferences: null,
        energises_me: null,
        drains_me: null,
        good_to_know: null,
        boundaries: null,
      })
    ).toBe(false);
  });
});
