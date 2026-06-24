/**
 * BUGS-50 / KAN-326 — resolvePostLoginRedirect shared helper.
 *
 * Both /auth/confirm (token-hash) and /auth/callback (OAuth) call this after a
 * session is established. It must: read the user, record beta-access, and feed
 * the resulting {userStatus, accessTier} into betaRedirectUrl. The
 * beta-access/flow module is mocked so we assert the wiring deterministically
 * (the routing matrix itself is covered by beta-access-flow.test.ts).
 */

const mockResolveBetaAccess = jest.fn();
const mockBetaRedirectUrl = jest.fn((opts?: unknown) => {
  void opts; // accept (and ignore) the opts arg; assertions use toHaveBeenCalledWith
  return 'REDIRECT_RESULT';
});
const mockIsProdFamily = jest.fn(() => false);

jest.mock('@/lib/beta-access/flow', () => ({
  resolveBetaAccess: (u: unknown) => mockResolveBetaAccess(u),
  betaRedirectUrl: (o: unknown) => mockBetaRedirectUrl(o),
  isProdFamily: () => mockIsProdFamily(),
}));

import { resolvePostLoginRedirect } from '@/lib/auth/post-login-redirect';

// Minimal stand-in for the Supabase server client — only auth.getUser is used.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeSupabase(user: unknown): any {
  return { auth: { getUser: async () => ({ data: { user } }) } };
}

beforeEach(() => {
  mockResolveBetaAccess.mockReset();
  mockBetaRedirectUrl.mockClear();
  mockBetaRedirectUrl.mockReturnValue('REDIRECT_RESULT');
  mockIsProdFamily.mockReset();
  mockIsProdFamily.mockReturnValue(false);
});

describe('resolvePostLoginRedirect', () => {
  test('records beta access for the signed-in user and feeds the tier into betaRedirectUrl', async () => {
    mockResolveBetaAccess.mockResolvedValue({ userStatus: 'live', accessTier: 'prod' });
    mockIsProdFamily.mockReturnValue(true);
    const supabase = fakeSupabase({ id: 'user-1', email: 'ben@example.com' });

    const url = await resolvePostLoginRedirect(supabase, 'https://checklyra.com', '/dashboard');

    expect(mockResolveBetaAccess).toHaveBeenCalledWith({ id: 'user-1', email: 'ben@example.com' });
    expect(mockBetaRedirectUrl).toHaveBeenCalledWith({
      origin: 'https://checklyra.com',
      isProdFamily: true,
      userStatus: 'live',
      accessTier: 'prod',
      next: '/dashboard',
    });
    expect(url).toBe('REDIRECT_RESULT');
  });

  test('passes a not-live status through to betaRedirectUrl (waitlist routing)', async () => {
    mockResolveBetaAccess.mockResolvedValue({ userStatus: 'waitlist', accessTier: 'beta' });
    const supabase = fakeSupabase({ id: 'user-2', email: null });

    await resolvePostLoginRedirect(supabase, 'https://checklyra.com', '/dashboard');

    expect(mockBetaRedirectUrl).toHaveBeenCalledWith(
      expect.objectContaining({ userStatus: 'waitlist', accessTier: 'beta' }),
    );
  });

  test('no user: skips beta-access lookup and stays on origin (defensive)', async () => {
    const supabase = fakeSupabase(null);

    await resolvePostLoginRedirect(supabase, 'https://dev.checklyra.com', '/dashboard');

    expect(mockResolveBetaAccess).not.toHaveBeenCalled();
    expect(mockBetaRedirectUrl).toHaveBeenCalledWith(
      expect.objectContaining({ isProdFamily: false, userStatus: 'live' }),
    );
  });
});
