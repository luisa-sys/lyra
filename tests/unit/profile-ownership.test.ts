/**
 * KAN-260: the profile mutations that previously relied on RLS alone must
 * also scope their write to the caller's own profile_id in code. This is a
 * regression safety-net for "only you can edit your own profile" — so a
 * row that isn't yours can never be edited/deleted even if a database
 * policy were ever misconfigured.
 */

const mockRevalidatePath = jest.fn();
jest.mock('next/cache', () => ({
  revalidatePath: (...a: unknown[]) => mockRevalidatePath(...a),
}));

// Record every .eq(col, val) call keyed by table so we can assert the
// owner scope. `mockState` lets a test tweak the auth user / mutation result.
const mockEqCalls: Record<string, Array<[string, unknown]>> = {};
const mockState: { userId: string | null; mutationError: { message: string } | null } = {
  userId: 'user-1',
  mutationError: null,
};

jest.mock('@/lib/supabase-server', () => {
  type Builder = {
    select: () => Builder;
    delete: () => Builder;
    update: () => Builder;
    insert: () => Builder;
    eq: (col: string, val: unknown) => Builder;
    single: () => Promise<{ data: { id: string } | null; error: null }>;
    then: (
      resolve: (v: { error: { message: string } | null }) => unknown,
      reject?: (e: unknown) => unknown,
    ) => Promise<unknown>;
  };
  const build = (table: string): Builder => {
    const b: Builder = {
      select: () => b,
      delete: () => b,
      update: () => b,
      insert: () => b,
      eq: (col, val) => {
        (mockEqCalls[table] = mockEqCalls[table] ?? []).push([col, val]);
        return b;
      },
      single: () =>
        Promise.resolve(
          table === 'profiles'
            ? { data: { id: 'profile-1' }, error: null }
            : { data: null, error: null },
        ),
      then: (resolve, reject) =>
        Promise.resolve({ error: mockState.mutationError }).then(resolve, reject),
    };
    return b;
  };
  return {
    createClient: jest.fn().mockResolvedValue({
      auth: {
        getUser: () =>
          Promise.resolve({ data: { user: mockState.userId ? { id: mockState.userId } : null } }),
      },
      from: (t: string) => build(t),
    }),
  };
});

import {
  removeProfileItem,
  removeSchoolAffiliation,
  removeExternalLink,
  updateProfileItemVisibility,
} from '@/app/dashboard/profile/actions';

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockEqCalls)) delete mockEqCalls[key];
  mockState.userId = 'user-1';
  mockState.mutationError = null;
});

function ownerScoped(table: string): boolean {
  return (mockEqCalls[table] ?? []).some(
    ([col, val]) => col === 'profile_id' && val === 'profile-1',
  );
}

describe('KAN-260: profile mutations are owner-scoped in code (not RLS alone)', () => {
  test('removeProfileItem scopes the delete to the caller profile_id', async () => {
    const res = await removeProfileItem('item-9');
    expect(res).toEqual({ success: true });
    expect(mockEqCalls['profile_items']).toContainEqual(['id', 'item-9']);
    expect(ownerScoped('profile_items')).toBe(true);
  });

  test('updateProfileItemVisibility scopes the update to the caller profile_id', async () => {
    const res = await updateProfileItemVisibility('item-9', 'public');
    expect(res).toEqual({ success: true });
    expect(ownerScoped('profile_items')).toBe(true);
  });

  test('removeSchoolAffiliation scopes the delete to the caller profile_id', async () => {
    const res = await removeSchoolAffiliation('aff-3');
    expect(res).toEqual({ success: true });
    expect(mockEqCalls['school_affiliations']).toContainEqual(['id', 'aff-3']);
    expect(ownerScoped('school_affiliations')).toBe(true);
  });

  test('removeExternalLink scopes the delete to the caller profile_id', async () => {
    const res = await removeExternalLink('link-2');
    expect(res).toEqual({ success: true });
    expect(ownerScoped('external_links')).toBe(true);
  });

  test('not authenticated → no write attempted', async () => {
    mockState.userId = null;
    const res = await removeProfileItem('item-9');
    expect(res).toEqual({ success: false, error: 'Not authenticated' });
    expect(mockEqCalls['profile_items']).toBeUndefined();
  });
});
