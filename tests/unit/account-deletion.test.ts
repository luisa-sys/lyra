/**
 * KAN-259: deleteAccount must be a TRUE erasure — it deletes the auth user
 * (which cascades to every profile-owned table) and cleans up orphaned
 * storage objects, rather than only deleting the profile row.
 */

// next/navigation redirect throws so we can assert the target.
const mockRedirect = jest.fn();
jest.mock('next/navigation', () => ({
  redirect: (...args: unknown[]) => { mockRedirect(...args); throw new Error('REDIRECT'); },
}));

// Cookie-auth client: only used for getUser + signOut here.
const mockGetUser = jest.fn();
const mockSignOut = jest.fn();
jest.mock('@/modules/platform/supabase-server', () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: {
      getUser: (...a: unknown[]) => mockGetUser(...a),
      signOut: (...a: unknown[]) => mockSignOut(...a),
    },
  }),
}));

// Service-role admin client: deletes the auth user + storage objects, and
// (SEC-75 leg b) records the external-processor erasure obligation via RPC.
const mockAdminDeleteUser = jest.fn();
const mockStorageList = jest.fn();
const mockStorageRemove = jest.fn();
const mockRpc = jest.fn();
jest.mock('@/modules/admin/admin', () => ({
  getAdminServiceClient: () => ({
    auth: { admin: { deleteUser: (...a: unknown[]) => mockAdminDeleteUser(...a) } },
    rpc: (...a: unknown[]) => mockRpc(...a),
    storage: {
      from: () => ({
        list: (...a: unknown[]) => mockStorageList(...a),
        remove: (...a: unknown[]) => mockStorageRemove(...a),
      }),
    },
  }),
}));

// SEC-75 leg (b) added a `@sentry/nextjs` import to the action for the
// best-effort obligation-logging catch path. Mock it so the unit test doesn't
// pull in Sentry's runtime (which needs network egress).
const mockCaptureException = jest.fn();
jest.mock('@sentry/nextjs', () => ({
  captureException: (...a: unknown[]) => mockCaptureException(...a),
}));

import { deleteAccount } from '@/app/dashboard/settings/actions';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123', email: 'a@b.com' } } });
  mockAdminDeleteUser.mockResolvedValue({ data: {}, error: null });
  mockRpc.mockResolvedValue({ data: 'oblig-1', error: null });
  mockStorageList.mockResolvedValue({ data: [] });
  mockStorageRemove.mockResolvedValue({ error: null });
  mockSignOut.mockResolvedValue({ error: null });
});

describe('KAN-259: deleteAccount (true erasure)', () => {
  test('redirects to /login when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await expect(deleteAccount()).rejects.toThrow('REDIRECT');
    expect(mockRedirect).toHaveBeenCalledWith('/login');
    expect(mockAdminDeleteUser).not.toHaveBeenCalled();
  });

  test('hard-deletes the auth user (cascade), signs out, and redirects home', async () => {
    await expect(deleteAccount()).rejects.toThrow('REDIRECT');
    expect(mockAdminDeleteUser).toHaveBeenCalledWith('user-123');
    expect(mockSignOut).toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenLastCalledWith('/');
  });

  test('removes orphaned storage objects in both buckets', async () => {
    mockStorageList.mockResolvedValue({ data: [{ name: 'avatar.png' }] });
    await expect(deleteAccount()).rejects.toThrow('REDIRECT');
    expect(mockStorageList).toHaveBeenCalledTimes(2); // profile-photos + profile-files
    expect(mockStorageRemove).toHaveBeenCalledWith(['user-123/avatar.png']);
  });

  test('does NOT sign out or wipe storage if the auth deletion fails (no partial delete)', async () => {
    mockAdminDeleteUser.mockResolvedValue({ data: {}, error: { message: 'update or delete on table violates foreign key' } });
    await expect(deleteAccount()).rejects.toThrow('REDIRECT');
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockStorageRemove).not.toHaveBeenCalled();
    expect(mockRedirect.mock.calls.at(-1)?.[0]).toContain('/dashboard/settings?error=');
  });

  test('a storage-cleanup failure does not block the deletion', async () => {
    mockStorageList.mockRejectedValue(new Error('storage unavailable'));
    await expect(deleteAccount()).rejects.toThrow('REDIRECT');
    expect(mockAdminDeleteUser).toHaveBeenCalled();
    expect(mockSignOut).toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenLastCalledWith('/');
  });
});

describe('SEC-75 leg (b): erasure-obligation recording', () => {
  test('records an obligation for the deleted user with email + external processors', async () => {
    await expect(deleteAccount()).rejects.toThrow('REDIRECT');
    expect(mockRpc).toHaveBeenCalledTimes(1);
    const [fn, args] = mockRpc.mock.calls[0];
    expect(fn).toBe('record_erasure_obligation');
    expect(args.p_subject_user_id).toBe('user-123');
    expect(args.p_subject_email).toBe('a@b.com');
    // Must name every external system that may still hold a copy.
    expect(args.p_processors).toEqual(
      expect.arrayContaining(['cloudflare_kv_waitlist', 'resend', 'didit', 'google']),
    );
    expect(typeof args.p_notes).toBe('string');
  });

  test('does NOT record an obligation when the auth deletion fails (nothing was erased)', async () => {
    mockAdminDeleteUser.mockResolvedValue({ data: {}, error: { message: 'update or delete on table violates foreign key' } });
    await expect(deleteAccount()).rejects.toThrow('REDIRECT');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('a returned RPC error is captured to Sentry but does not block the erasure', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'insert failed' } });
    await expect(deleteAccount()).rejects.toThrow('REDIRECT');
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenLastCalledWith('/');
  });

  test('a thrown RPC error is captured to Sentry but does not block the erasure', async () => {
    mockRpc.mockRejectedValue(new Error('network down'));
    await expect(deleteAccount()).rejects.toThrow('REDIRECT');
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenLastCalledWith('/');
  });
});
