import { approveBetaUser } from '@/app/admin/beta-queue/actions';

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

const mockGetCurrentAdmin = jest.fn();
const mockUpdateEq = jest.fn();
const mockGetUserById = jest.fn();
const mockLog = jest.fn();
const mockEmail = jest.fn();

jest.mock('@/lib/admin', () => ({
  getCurrentAdmin: () => mockGetCurrentAdmin(),
  getAdminServiceClient: () => ({
    from: () => ({ update: () => ({ eq: (...a: unknown[]) => mockUpdateEq(...a) }) }),
    auth: { admin: { getUserById: (...a: unknown[]) => mockGetUserById(...a) } },
  }),
  logModerationAction: (...a: unknown[]) => mockLog(...a),
}));

jest.mock('@/lib/beta-access/email', () => ({
  sendBetaApprovedEmail: (...a: unknown[]) => mockEmail(...a),
}));

function fd(obj: Record<string, string>): FormData {
  const f = new FormData();
  Object.entries(obj).forEach(([k, v]) => f.set(k, v));
  return f;
}

const ADMIN = { userId: 'a', profileId: 'ap', email: null, displayName: 'A' };

describe('approveBetaUser (KAN-277)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateEq.mockResolvedValue({ error: null });
    mockGetUserById.mockResolvedValue({ data: { user: { email: 'new@user.com' } } });
    mockLog.mockResolvedValue('log-id');
    mockEmail.mockResolvedValue({ ok: true, messageId: 'm1' });
  });

  it('rejects non-admins and performs no mutation', async () => {
    mockGetCurrentAdmin.mockResolvedValue(null);
    await expect(approveBetaUser(fd({ profile_id: 'p1', user_id: 'u1' }))).rejects.toThrow(
      'Not authorised',
    );
    expect(mockUpdateEq).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
    expect(mockEmail).not.toHaveBeenCalled();
  });

  it('rejects a missing target profile', async () => {
    mockGetCurrentAdmin.mockResolvedValue(ADMIN);
    await expect(approveBetaUser(fd({ profile_id: '', user_id: '' }))).rejects.toThrow(
      'Missing target',
    );
    expect(mockUpdateEq).not.toHaveBeenCalled();
  });

  it('approves: updates the profile, audit-logs grant_beta_access, emails the user', async () => {
    mockGetCurrentAdmin.mockResolvedValue(ADMIN);
    await approveBetaUser(fd({ profile_id: 'p1', user_id: 'u1' }));
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'p1');
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'grant_beta_access', targetProfileId: 'p1' }),
    );
    expect(mockEmail).toHaveBeenCalledWith({ to: 'new@user.com' });
  });

  it('still completes if the approval email step throws', async () => {
    mockGetCurrentAdmin.mockResolvedValue(ADMIN);
    mockGetUserById.mockRejectedValue(new Error('auth down'));
    await expect(approveBetaUser(fd({ profile_id: 'p1', user_id: 'u1' }))).resolves.toBeUndefined();
    expect(mockLog).toHaveBeenCalled();
  });

  it('throws if the profile update fails (no silent success)', async () => {
    mockGetCurrentAdmin.mockResolvedValue(ADMIN);
    mockUpdateEq.mockResolvedValue({ error: { message: 'db down' } });
    await expect(approveBetaUser(fd({ profile_id: 'p1', user_id: 'u1' }))).rejects.toThrow(
      'Could not approve',
    );
    expect(mockLog).not.toHaveBeenCalled();
  });
});
