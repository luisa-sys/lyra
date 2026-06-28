/**
 * KAN-336: resolveBetaAccess — server-side invite-code grant.
 *
 * The grant goes through the service-role client (admin-only trigger). We mock
 * @supabase/supabase-js's createClient and verify that a carried invite code in
 * user_metadata, re-validated against env.inviteCode(), fast-tracks the user
 * into beta via the canonical enable_beta transition; otherwise they waitlist.
 */

let mockInviteCode = '';
let mockProfile: Record<string, unknown> | null = null;
let mockUserMetadata: Record<string, unknown> = {};
let mockWaitlistUpdated: Array<{ user_id: string }> = [{ user_id: 'u1' }];
const updateSpy = jest.fn();
const getUserByIdSpy = jest.fn();
const mockSendBetaQueueNotice = jest.fn();

jest.mock('@/lib/env', () => ({
  env: {
    supabaseUrl: () => 'https://x.supabase.co',
    supabaseServiceRoleKey: () => 'svc-key',
    inviteCode: () => mockInviteCode,
  },
}));

jest.mock('@/lib/beta-access/email', () => ({
  sendBetaQueueNotice: (...args: unknown[]) => mockSendBetaQueueNotice(...args),
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: mockProfile }) }),
      }),
      update: (payload: Record<string, unknown>) => {
        updateSpy(payload);
        return {
          eq: () => ({
            // grant path: `await svc.from().update().eq()` resolves here
            then: (resolve: (v: unknown) => void) => resolve({ data: null }),
            // waitlist path: `.eq().is().select()` (idempotent on beta_requested_at IS NULL)
            is: () => ({ select: () => Promise.resolve({ data: mockWaitlistUpdated }) }),
          }),
        };
      },
    }),
    auth: {
      admin: {
        getUserById: (id: string) => {
          getUserByIdSpy(id);
          return Promise.resolve({ data: { user: { user_metadata: mockUserMetadata } } });
        },
      },
    },
  }),
}));

import { resolveBetaAccess } from '@/lib/beta-access/flow';

beforeEach(() => {
  jest.clearAllMocks();
  mockInviteCode = '';
  mockProfile = {
    user_status: 'waitlist',
    access_tier: 'beta',
    beta_requested_at: null,
    display_name: 'A',
  };
  mockUserMetadata = {};
  mockWaitlistUpdated = [{ user_id: 'u1' }];
});

describe('KAN-336: resolveBetaAccess invite-code grant', () => {
  it('grants beta when the carried code matches the configured code', async () => {
    mockInviteCode = 'SECRET-123';
    mockUserMetadata = { full_name: 'A', invite_code: 'SECRET-123' };

    const result = await resolveBetaAccess({ id: 'u1', email: 'a@b.com' });

    expect(result).toEqual({ userStatus: 'live', accessTier: 'beta' });
    expect(getUserByIdSpy).toHaveBeenCalledWith('u1');
    // The canonical enable_beta column set was applied (real computeAccessTransition).
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0][0]).toMatchObject({
      user_status: 'live',
      access_tier: 'beta',
    });
    // KAN-326 Phase C: the grant writes only the new axes (+ audit ts), no legacy cols.
    for (const col of ['access_stage', 'early_access', 'is_beta_eligible', 'beta_access_status']) {
      expect(updateSpy.mock.calls[0][0]).not.toHaveProperty(col);
    }
    // No waitlist queue notice for a self-redeemed code.
    expect(mockSendBetaQueueNotice).not.toHaveBeenCalled();
  });

  it('does NOT grant when the carried code is wrong — falls back to the waitlist', async () => {
    mockInviteCode = 'SECRET-123';
    mockUserMetadata = { invite_code: 'WRONG' };

    const result = await resolveBetaAccess({ id: 'u1', email: 'a@b.com' });

    expect(result).toEqual({ userStatus: 'waitlist', accessTier: 'beta' });
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0][0]).toMatchObject({
      user_status: 'waitlist',
      beta_requested_at: expect.any(String),
    });
    expect(mockSendBetaQueueNotice).toHaveBeenCalled();
  });

  it('does NOT grant when no code is configured (getUserById skipped) — waitlist', async () => {
    mockInviteCode = '';
    mockUserMetadata = { invite_code: 'SECRET-123' }; // present, but feature is off

    const result = await resolveBetaAccess({ id: 'u1', email: 'a@b.com' });

    expect(result).toEqual({ userStatus: 'waitlist', accessTier: 'beta' });
    expect(getUserByIdSpy).not.toHaveBeenCalled();
    expect(updateSpy.mock.calls[0][0]).toMatchObject({ user_status: 'waitlist', beta_requested_at: expect.any(String) });
  });

  it('is a no-op for an already-live user (no grant, no waitlist write)', async () => {
    mockInviteCode = 'SECRET-123';
    mockProfile = { user_status: 'live', access_tier: 'beta' };
    mockUserMetadata = { invite_code: 'SECRET-123' };

    const result = await resolveBetaAccess({ id: 'u1', email: 'a@b.com' });

    expect(result).toEqual({ userStatus: 'live', accessTier: 'beta' });
    expect(updateSpy).not.toHaveBeenCalled();
    expect(getUserByIdSpy).not.toHaveBeenCalled();
  });

  // KAN-337 — the /join deep-link cookie reaches resolveBetaAccess as carriedCode
  // (the only carrier for Google OAuth, which has no sign-up form / user_metadata).
  it('KAN-337: grants beta via the carried cookie code, skipping the metadata lookup', async () => {
    mockInviteCode = 'SECRET-123';
    mockUserMetadata = {}; // no code in user_metadata — OAuth path

    const result = await resolveBetaAccess(
      { id: 'u1', email: 'a@b.com' },
      { carriedCode: 'SECRET-123' },
    );

    expect(result).toEqual({ userStatus: 'live', accessTier: 'beta' });
    // The cookie matched first, so the user_metadata lookup is never made.
    expect(getUserByIdSpy).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0][0]).toMatchObject({ user_status: 'live', access_tier: 'beta' });
    for (const col of ['access_stage', 'early_access', 'is_beta_eligible', 'beta_access_status']) {
      expect(updateSpy.mock.calls[0][0]).not.toHaveProperty(col);
    }
  });

  it('KAN-337: a wrong carried cookie code falls through to user_metadata (no grant → waitlist)', async () => {
    mockInviteCode = 'SECRET-123';
    mockUserMetadata = { invite_code: 'WRONG' };

    const result = await resolveBetaAccess(
      { id: 'u1', email: 'a@b.com' },
      { carriedCode: 'ALSO-WRONG' },
    );

    expect(result).toEqual({ userStatus: 'waitlist', accessTier: 'beta' });
    expect(getUserByIdSpy).toHaveBeenCalledWith('u1'); // fell through to the metadata check
    expect(mockSendBetaQueueNotice).toHaveBeenCalled();
  });
});
