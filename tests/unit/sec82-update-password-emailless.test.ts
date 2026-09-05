/**
 * SEC-82 (item 4) — updatePassword must require current-password proof. The
 * re-auth is email+password (signInWithPassword), so it was wrapped in
 * `if (user.email)`, letting an emailless (e.g. OAuth-provisioned) account set
 * a new password with ZERO proof of the old one. There is no way to prove
 * knowledge of the current password without an email, so the emailless path is
 * refused rather than silently allowed.
 */

const mockGetUser = jest.fn();
const mockSignIn = jest.fn();
const mockUpdateUser = jest.fn();

jest.mock('@/modules/platform/supabase-server', () => ({
  createClient: async () => ({
    auth: {
      getUser: (...a: unknown[]) => mockGetUser(...a),
      signInWithPassword: (...a: unknown[]) => mockSignIn(...a),
      updateUser: (...a: unknown[]) => mockUpdateUser(...a),
    },
  }),
}));

import { updatePassword } from '@/app/dashboard/settings/actions';

beforeEach(() => {
  jest.clearAllMocks();
  mockSignIn.mockResolvedValue({ error: null });
  mockUpdateUser.mockResolvedValue({ error: null });
});

describe('SEC-82: updatePassword current-password proof', () => {
  it('refuses an emailless account and never sets a password', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: null } } });
    const res = await updatePassword('whatever', 'newsecret');
    expect(res.error).toMatch(/add an email/i);
    expect(mockSignIn).not.toHaveBeenCalled();
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('rejects a wrong current password on an email account (no update)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.com' } } });
    mockSignIn.mockResolvedValue({ error: { message: 'bad creds' } });
    const res = await updatePassword('wrong', 'newsecret');
    expect(res.error).toBe('Current password is incorrect');
    expect(mockSignIn).toHaveBeenCalledWith({ email: 'a@b.com', password: 'wrong' });
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('updates the password when the current password proof succeeds', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.com' } } });
    const res = await updatePassword('correct', 'newsecret');
    expect(res.success).toBe(true);
    expect(mockSignIn).toHaveBeenCalledWith({ email: 'a@b.com', password: 'correct' });
    expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'newsecret' });
  });

  it('still enforces the minimum length before any auth work', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.com' } } });
    const res = await updatePassword('correct', 'short');
    expect(res.error).toMatch(/at least 6/i);
    expect(mockSignIn).not.toHaveBeenCalled();
  });
});
