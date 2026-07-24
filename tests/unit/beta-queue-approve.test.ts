/**
 * KAN-277 — approveBetaRequest core logic.
 *
 *   - logs a 'grant_beta_access' moderation action,
 *   - updates the profile to approved + is_beta_eligible + beta_approved_at,
 *   - resolves the user's email via auth.admin.getUserById and emails them,
 *   - returns { ok:true, emailed:true } on the happy path.
 */

const logMock = jest.fn();
const notifyApprovedMock = jest.fn();

// Capture the update payload + the getUserById arg through a fake service client.
const updateCapture: { values?: Record<string, unknown>; eqId?: string } = {};
const getUserByIdMock = jest.fn();

function fakeServiceClient() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { user_id: 'user-1', display_name: 'Ada' },
            error: null,
          }),
        }),
      }),
      update: (values: Record<string, unknown>) => {
        updateCapture.values = values;
        return {
          eq: async (_col: string, id: string) => {
            updateCapture.eqId = id;
            return { error: null };
          },
        };
      },
    }),
    auth: { admin: { getUserById: getUserByIdMock } },
  };
}

jest.mock('@/lib/admin', () => ({
  getAdminServiceClient: () => fakeServiceClient(),
  logModerationAction: (...args: unknown[]) => logMock(...args),
}));

jest.mock('@/lib/beta-access', () => ({
  notifyBetaApproved: (...args: unknown[]) => notifyApprovedMock(...args),
}));

import { approveBetaRequest } from '@/app/admin/beta-queue/approve';

const ADMIN = {
  userId: 'admin-u',
  profileId: 'admin-p',
  email: 'admin@b.com',
  displayName: 'Admin',
};

beforeEach(() => {
  logMock.mockReset();
  notifyApprovedMock.mockReset();
  getUserByIdMock.mockReset();
  updateCapture.values = undefined;
  updateCapture.eqId = undefined;
  getUserByIdMock.mockResolvedValue({ data: { user: { email: 'ada@example.com' } } });
});

describe('KAN-277 approveBetaRequest', () => {
  test('logs a grant_beta_access moderation action against the target profile', async () => {
    await approveBetaRequest(ADMIN, 'profile-9');
    expect(logMock).toHaveBeenCalledTimes(1);
    expect(logMock).toHaveBeenCalledWith({
      admin: ADMIN,
      action: 'grant_beta_access',
      targetProfileId: 'profile-9',
    });
  });

  test('sets beta_access_status=approved, is_beta_eligible=true, beta_approved_at', async () => {
    await approveBetaRequest(ADMIN, 'profile-9');
    expect(updateCapture.values?.beta_access_status).toBe('approved');
    expect(updateCapture.values?.is_beta_eligible).toBe(true);
    expect(typeof updateCapture.values?.beta_approved_at).toBe('string');
    expect(updateCapture.eqId).toBe('profile-9');
  });

  test('emails the approved user at their auth.users email', async () => {
    const res = await approveBetaRequest(ADMIN, 'profile-9');
    expect(getUserByIdMock).toHaveBeenCalledWith('user-1');
    expect(notifyApprovedMock).toHaveBeenCalledWith({
      to: 'ada@example.com',
      displayName: 'Ada',
    });
    expect(res).toEqual({ ok: true, emailed: true });
  });

  test('still approves (no email) when the user has no resolvable email', async () => {
    getUserByIdMock.mockResolvedValue({ data: { user: { email: null } } });
    const res = await approveBetaRequest(ADMIN, 'profile-9');
    expect(notifyApprovedMock).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: true, emailed: false });
    // The status flip still happened.
    expect(updateCapture.values?.beta_access_status).toBe('approved');
  });
});
