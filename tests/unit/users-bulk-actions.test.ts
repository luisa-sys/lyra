/**
 * KAN-309 / KAN-311: bulkUserAction — the privileged bulk mutation behind the
 * user-management console. Covers the security-critical contract:
 *   - non-admin rejected (no mutation, no audit)
 *   - both axes + gate written per the matrix; audit one row per target
 *   - the admin's own profile is excluded (self-action guard)
 *   - "select all matching filter" re-materialises IDs SERVER-SIDE (client IDs
 *     ignored)
 *   - the BULK_MAX cap is enforced
 *   - email failure does not abort the mutation
 *   - a DB update error throws (no silent success)
 */
import { bulkUserAction } from '@/app/admin/users/actions';
import { BULK_MAX } from '@/app/admin/users/users-actions-shared';

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

const mockGetCurrentAdmin = jest.fn();
const mockUpdateIn = jest.fn();
const mockSelectIn = jest.fn();
const mockGetUserById = jest.fn();
const mockLogBatch = jest.fn();
const mockEmail = jest.fn();
const mockRpc = jest.fn();

jest.mock('@/lib/admin', () => ({
  getCurrentAdmin: () => mockGetCurrentAdmin(),
  getAdminServiceClient: () => ({
    from: () => ({
      update: () => ({ in: (...a: unknown[]) => mockUpdateIn(...a) }),
      select: () => ({ in: (...a: unknown[]) => mockSelectIn(...a) }),
    }),
    auth: { admin: { getUserById: (...a: unknown[]) => mockGetUserById(...a) } },
  }),
  logModerationActionsBatch: (...a: unknown[]) => mockLogBatch(...a),
}));

jest.mock('@/lib/supabase-server', () => ({
  createClient: jest.fn().mockResolvedValue({ rpc: (...a: unknown[]) => mockRpc(...a) }),
}));

jest.mock('@/lib/beta-access/email', () => ({
  sendBetaApprovedEmail: (...a: unknown[]) => mockEmail(...a),
}));

const ADMIN = { userId: 'admin-user', profileId: 'admin-profile', email: 'a@a.com', displayName: 'A' };

function fd(fields: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) v.forEach((x) => f.append(k, x));
    else f.set(k, v);
  }
  return f;
}

describe('bulkUserAction (KAN-311)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentAdmin.mockResolvedValue(ADMIN);
    mockUpdateIn.mockResolvedValue({ error: null });
    mockSelectIn.mockResolvedValue({ data: [{ user_id: 'u1' }, { user_id: 'u2' }] });
    mockGetUserById.mockResolvedValue({ data: { user: { email: 'x@y.com' } } });
    mockLogBatch.mockResolvedValue(undefined);
    mockEmail.mockResolvedValue({ ok: true, messageId: 'm1' });
    mockRpc.mockResolvedValue({ data: ['p1', 'p2'], error: null });
  });

  it('rejects non-admins with no mutation and no audit', async () => {
    mockGetCurrentAdmin.mockResolvedValue(null);
    await expect(bulkUserAction(fd({ action: 'enable_beta', ids: ['p1'] }))).rejects.toThrow('Not authorised');
    expect(mockLogBatch).not.toHaveBeenCalled();
    expect(mockUpdateIn).not.toHaveBeenCalled();
  });

  it('rejects an unknown action', async () => {
    await expect(bulkUserAction(fd({ action: 'drop_table', ids: ['p1'] }))).rejects.toThrow('Unknown action');
    expect(mockUpdateIn).not.toHaveBeenCalled();
  });

  it('requires a reason to suspend', async () => {
    await expect(bulkUserAction(fd({ action: 'suspend', ids: ['p1'] }))).rejects.toThrow('reason is required');
    expect(mockUpdateIn).not.toHaveBeenCalled();
  });

  it('enable_beta: audits per target then updates both axes + gate, and emails', async () => {
    await bulkUserAction(fd({ action: 'enable_beta', ids: ['p1', 'p2'] }));
    expect(mockLogBatch).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'enable_beta', targetProfileIds: ['p1', 'p2'] }),
    );
    expect(mockUpdateIn).toHaveBeenCalledWith('id', ['p1', 'p2']);
    expect(mockEmail).toHaveBeenCalled();
  });

  it('excludes the admin\'s own profile from the batch', async () => {
    await bulkUserAction(fd({ action: 'enable_beta', ids: ['p1', ADMIN.profileId, 'p2'] }));
    expect(mockUpdateIn).toHaveBeenCalledWith('id', ['p1', 'p2']);
  });

  it('throws when only the admin selected themselves', async () => {
    await expect(bulkUserAction(fd({ action: 'enable_beta', ids: [ADMIN.profileId] }))).rejects.toThrow(
      'No users selected',
    );
    expect(mockUpdateIn).not.toHaveBeenCalled();
  });

  it('selectAll re-materialises IDs server-side and ignores client-sent IDs', async () => {
    await bulkUserAction(
      fd({ action: 'disable_beta', selectAll: 'true', f_stage: 'beta', ids: ['attacker-supplied'] }),
    );
    expect(mockRpc).toHaveBeenCalledWith('admin_filter_profile_ids', expect.objectContaining({ p_stage: 'beta' }));
    expect(mockUpdateIn).toHaveBeenCalledWith('id', ['p1', 'p2']);
  });

  it('enforces the BULK_MAX cap', async () => {
    const tooMany = Array.from({ length: BULK_MAX + 1 }, (_, i) => `id${i}`);
    await expect(bulkUserAction(fd({ action: 'enable_beta', ids: tooMany }))).rejects.toThrow('Too many users');
    expect(mockUpdateIn).not.toHaveBeenCalled();
  });

  it('does not send emails for non-approval transitions (disable_beta)', async () => {
    await bulkUserAction(fd({ action: 'disable_beta', ids: ['p1'] }));
    expect(mockUpdateIn).toHaveBeenCalledWith('id', ['p1']);
    expect(mockEmail).not.toHaveBeenCalled();
  });

  it('still completes if the approval email step throws', async () => {
    mockGetUserById.mockRejectedValue(new Error('auth down'));
    await expect(bulkUserAction(fd({ action: 'enable_beta', ids: ['p1'] }))).resolves.toBeUndefined();
    expect(mockUpdateIn).toHaveBeenCalled();
  });

  it('throws if the DB update fails (no silent success)', async () => {
    mockUpdateIn.mockResolvedValue({ error: { message: 'db down' } });
    await expect(bulkUserAction(fd({ action: 'enable_beta', ids: ['p1'] }))).rejects.toThrow('Could not update users');
  });
});
