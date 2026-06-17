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
jest.mock('@/lib/supabase-server', () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: {
      getUser: (...a: unknown[]) => mockGetUser(...a),
      signOut: (...a: unknown[]) => mockSignOut(...a),
    },
  }),
}));

// Service-role admin client: deletes the auth user + storage objects.
const mockAdminDeleteUser = jest.fn();
const mockStorageList = jest.fn();
const mockStorageRemove = jest.fn();
jest.mock('@/lib/admin', () => ({
  getAdminServiceClient: () => ({
    auth: { admin: { deleteUser: (...a: unknown[]) => mockAdminDeleteUser(...a) } },
    storage: {
      from: () => ({
        list: (...a: unknown[]) => mockStorageList(...a),
        remove: (...a: unknown[]) => mockStorageRemove(...a),
      }),
    },
  }),
}));

import { deleteAccount } from '@/app/dashboard/settings/actions';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123', email: 'a@b.com' } } });
  mockAdminDeleteUser.mockResolvedValue({ data: {}, error: null });
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
