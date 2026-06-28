/**
 * KAN-336 — redeemWaitlistCode: skip-the-waitlist code redemption from /waitlist.
 *
 * Google/OAuth signups can't carry an invite code through the magic-link flow,
 * so they always land on the waitlist; this action lets an authenticated
 * waitlisted user paste the same code to skip the queue. The grant goes through
 * the service-role client (admin-only trigger) using the canonical enable_beta
 * transition. We mock the server client, the service-role client, env and
 * next/navigation's redirect (which throws), and assert each branch.
 */

let mockInviteCode = '';
let mockUser: { id: string } | null = { id: 'u1' };
const updateSpy = jest.fn();
const eqSpy = jest.fn();

jest.mock('@/lib/env', () => ({
  env: {
    supabaseUrl: () => 'https://x.supabase.co',
    supabaseServiceRoleKey: () => 'svc-key',
    inviteCode: () => mockInviteCode,
  },
}));

jest.mock('@/lib/supabase-server', () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: () => Promise.resolve({ data: { user: mockUser } }) },
    }),
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        updateSpy(payload);
        return {
          eq: (col: string, val: string) => {
            eqSpy(col, val);
            return Promise.resolve({ data: null });
          },
        };
      },
    }),
  }),
}));

class RedirectError extends Error {
  constructor(public url: string) {
    super(`REDIRECT:${url}`);
  }
}
jest.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
}));

import { redeemWaitlistCode } from '@/app/waitlist/actions';

function fd(code?: string): FormData {
  const f = new FormData();
  if (code !== undefined) f.set('invite_code', code);
  return f;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockInviteCode = 'SECRET-123';
  mockUser = { id: 'u1' };
});

describe('KAN-336: redeemWaitlistCode', () => {
  it('grants beta + redirects to /dashboard when the code matches', async () => {
    await expect(redeemWaitlistCode(fd('SECRET-123'))).rejects.toThrow('REDIRECT:/dashboard');
    // The canonical enable_beta column set was applied via the service role.
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0][0]).toMatchObject({ user_status: 'live', access_tier: 'beta' });
    // KAN-326 Phase C: no legacy state columns are written.
    for (const col of ['access_stage', 'early_access', 'is_beta_eligible', 'beta_access_status']) {
      expect(updateSpy.mock.calls[0][0]).not.toHaveProperty(col);
    }
    expect(eqSpy).toHaveBeenCalledWith('user_id', 'u1');
  });

  it('trims surrounding whitespace before comparing', async () => {
    await expect(redeemWaitlistCode(fd('  SECRET-123  '))).rejects.toThrow('REDIRECT:/dashboard');
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT grant + redirects with an error when the code is wrong', async () => {
    await expect(redeemWaitlistCode(fd('WRONG'))).rejects.toThrow('REDIRECT:/waitlist?error=invalid');
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('does NOT grant when the code is blank', async () => {
    await expect(redeemWaitlistCode(fd(''))).rejects.toThrow('REDIRECT:/waitlist?error=invalid');
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('does NOT grant when no code is configured (feature off)', async () => {
    mockInviteCode = '';
    await expect(redeemWaitlistCode(fd('SECRET-123'))).rejects.toThrow('REDIRECT:/waitlist?error=invalid');
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('redirects unauthenticated users to /login without granting', async () => {
    mockUser = null;
    await expect(redeemWaitlistCode(fd('SECRET-123'))).rejects.toThrow('REDIRECT:/login');
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
