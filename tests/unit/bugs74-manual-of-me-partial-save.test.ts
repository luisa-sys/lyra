/**
 * BUGS-74 — updateManualOfMe must be genuinely partial-safe.
 *
 * Its doc comment always claimed it "accepts a partial", but an `undefined`
 * value was coerced to null and written, so a caller that sent an incomplete
 * object silently destroyed the fields it omitted. That is exactly how the
 * profile editor deleted members' `good_to_know` / `boundaries` text.
 *
 * These tests pin the distinction the fix introduces:
 *   undefined  → NOT PROVIDED   → omitted from the upsert (DB value untouched)
 *   null / ''  → EXPLICIT CLEAR → written as NULL
 *
 * The second half is just as important as the first: making the action
 * partial-safe must not break a member's ability to actually empty a box.
 */

// --- Mocks (mirrors tests/unit/manual-of-me-actions.test.ts) -------------

const mockRevalidatePath = jest.fn();
jest.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

const mockUpsertCapture = jest.fn();
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

beforeEach(() => {
  mockUpsertCapture.mockClear();
  mockRevalidatePath.mockClear();
  mockGetUser.mockReset();
  mockProfileSelectSingle.mockReset();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  mockProfileSelectSingle.mockResolvedValue({ data: { id: 'profile-1' }, error: null });
});

const payloadOf = () => mockUpsertCapture.mock.calls[0][0] as Record<string, unknown>;

describe('BUGS-74 — "not provided" never destroys a stored value', () => {
  test('a single-field update leaves the other five out of the upsert entirely', async () => {
    const result = await updateManualOfMe({ communication_style: 'Async please' });

    expect(result).toEqual({ success: true });
    // The whole point: absent keys must not appear in the payload at all.
    // A key present with value null would still NULL the column.
    expect(payloadOf()).toEqual({
      profile_id: 'profile-1',
      communication_style: 'Async please',
    });
  });

  test('explicitly-undefined keys are dropped, not written as null (the data-loss path)', async () => {
    // This is the exact shape the editor used to send: the two fields it never
    // loaded came through as undefined and were written as NULL.
    await updateManualOfMe({
      communication_style: 'Async please',
      good_to_know: undefined,
      boundaries: undefined,
    });

    const payload = payloadOf();
    expect(payload).not.toHaveProperty('good_to_know');
    expect(payload).not.toHaveProperty('boundaries');
    expect(payload).toEqual({
      profile_id: 'profile-1',
      communication_style: 'Async please',
    });
  });

  test('an all-undefined payload is a no-op success — no DB write at all', async () => {
    const result = await updateManualOfMe({
      good_to_know: undefined,
      boundaries: undefined,
    });

    expect(result).toEqual({ success: true });
    expect(mockUpsertCapture).not.toHaveBeenCalled();
  });
});

describe('BUGS-74 — explicit clears still clear (the fix must not overshoot)', () => {
  test('empty string still writes NULL', async () => {
    await updateManualOfMe({ good_to_know: '' });
    expect(payloadOf()).toEqual({ profile_id: 'profile-1', good_to_know: null });
  });

  test('explicit null still writes NULL', async () => {
    await updateManualOfMe({ boundaries: null });
    expect(payloadOf()).toEqual({ profile_id: 'profile-1', boundaries: null });
  });

  test('whitespace-only still writes NULL (sanitised to empty)', async () => {
    await updateManualOfMe({ good_to_know: '   ' });
    expect(payloadOf()).toEqual({ profile_id: 'profile-1', good_to_know: null });
  });

  test('clearing one field while omitting another clears only the one', async () => {
    await updateManualOfMe({ good_to_know: '', boundaries: undefined });

    const payload = payloadOf();
    expect(payload).toEqual({ profile_id: 'profile-1', good_to_know: null });
    expect(payload).not.toHaveProperty('boundaries');
  });
});
