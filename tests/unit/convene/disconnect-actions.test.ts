/**
 * SEC-109 — tests for the server-side Convene disconnect action.
 *
 * The defect these pin: the browser used to soft-delete `oauth_connections`
 * directly and never revoke the vaulted refresh token. The whole point of the
 * action is that a successful disconnect reaches `disconnectConnection`, which
 * is what calls `vaultRevokeRefreshToken` — so "did the vault revoke happen"
 * is asserted as "was disconnectConnection invoked".
 */

const mockRevalidatePath = jest.fn();
jest.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => mockRevalidatePath(...a) }));

const mockDisconnectConnection = jest.fn(async (id: string) => {
  void id;
});
jest.mock('@/lib/convene/oauth-connections', () => ({
  disconnectConnection: (id: string) => mockDisconnectConnection(id),
}));

let mockUserId: string | null = 'owner-1';
// Rows visible to the *caller's own* client, keyed by `${id}::${ownerUserId}`.
let ownedRows: Set<string> = new Set();
let lookupError: unknown = null;
// 'ok' | 'suspended' | 'missing-row' | 'error' — drives the profiles read that
// getAccountStanding performs.
let standing = 'ok';
const captured = {
  lookups: [] as Record<string, unknown>[],
  profileLookups: [] as Record<string, unknown>[],
};

jest.mock('@/lib/supabase-server', () => ({
  createClient: jest.fn(async () => ({
    auth: {
      getUser: jest.fn(async () => ({
        data: { user: mockUserId ? { id: mockUserId } : null },
      })),
    },
    from: jest.fn((table: string) => ({
      select: () => {
        const filters: Record<string, unknown> = { table };
        const chain: Record<string, unknown> = {};
        chain.eq = (col: string, val: unknown) => {
          filters[col] = val;
          return chain;
        };
        chain.is = (col: string, val: unknown) => {
          filters[col] = val;
          return chain;
        };
        chain.maybeSingle = async () => {
          if (table === 'profiles') {
            captured.profileLookups.push(filters);
            if (standing === 'error') return { data: null, error: { message: 'profiles boom' } };
            if (standing === 'missing-row') return { data: null, error: null };
            return { data: { is_suspended: standing === 'suspended' }, error: null };
          }
          captured.lookups.push(filters);
          if (lookupError) return { data: null, error: lookupError };
          const key = `${String(filters.id)}::${String(filters.owner_user_id)}`;
          return { data: ownedRows.has(key) ? { id: filters.id } : null, error: null };
        };
        return chain;
      },
    })),
  })),
}));

import { disconnectOAuthConnection } from '@/app/dashboard/convene/connections/disconnect-actions';

beforeEach(() => {
  mockUserId = 'owner-1';
  ownedRows = new Set(['conn-1::owner-1', 'conn-2::owner-2']);
  lookupError = null;
  standing = 'ok';
  captured.lookups = [];
  captured.profileLookups = [];
  mockRevalidatePath.mockClear();
  mockDisconnectConnection.mockClear();
  mockDisconnectConnection.mockImplementation(async () => undefined);
});

describe('disconnectOAuthConnection', () => {
  test('disconnecting your own connection revokes the vaulted token', async () => {
    const res = await disconnectOAuthConnection('conn-1');
    expect(res).toEqual({ ok: true });
    // disconnectConnection is the only path that calls vaultRevokeRefreshToken.
    expect(mockDisconnectConnection).toHaveBeenCalledTimes(1);
    expect(mockDisconnectConnection).toHaveBeenCalledWith('conn-1');
    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard/convene/connections');
  });

  test('the ownership lookup is scoped to the caller and to live rows', async () => {
    await disconnectOAuthConnection('conn-1');
    expect(captured.lookups).toHaveLength(1);
    expect(captured.lookups[0]).toMatchObject({
      table: 'oauth_connections',
      id: 'conn-1',
      owner_user_id: 'owner-1',
      deleted_at: null,
    });
  });

  test('user A cannot disconnect user B connection', async () => {
    // conn-2 belongs to owner-2; the caller is owner-1.
    const res = await disconnectOAuthConnection('conn-2');
    expect(res.ok).toBe(false);
    expect(mockDisconnectConnection).not.toHaveBeenCalled();
  });

  test('a foreign connection fails with the same message as an unknown one', async () => {
    const foreign = await disconnectOAuthConnection('conn-2');
    const unknown = await disconnectOAuthConnection('no-such-connection');
    expect(foreign).toEqual(unknown);
    expect(foreign.ok).toBe(false);
  });

  test('rejects unauthenticated callers before any lookup', async () => {
    mockUserId = null;
    const res = await disconnectOAuthConnection('conn-1');
    expect(res.ok).toBe(false);
    expect(captured.lookups).toHaveLength(0);
    expect(mockDisconnectConnection).not.toHaveBeenCalled();
  });

  test('rejects an empty or blank connection id without touching the database', async () => {
    for (const bad of ['', '   ']) {
      const res = await disconnectOAuthConnection(bad);
      expect(res.ok).toBe(false);
    }
    expect(captured.lookups).toHaveLength(0);
    expect(mockDisconnectConnection).not.toHaveBeenCalled();
  });

  test('surfaces a generic error if the ownership lookup fails', async () => {
    lookupError = { message: 'boom' };
    const res = await disconnectOAuthConnection('conn-1');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).not.toContain('boom');
    expect(mockDisconnectConnection).not.toHaveBeenCalled();
  });

  test('refuses a confirmed-suspended caller before touching the connection', async () => {
    standing = 'suspended';
    const res = await disconnectOAuthConnection('conn-1');
    expect(res.ok).toBe(false);
    expect(captured.profileLookups[0]).toMatchObject({ table: 'profiles', user_id: 'owner-1' });
    expect(captured.lookups).toHaveLength(0);
    expect(mockDisconnectConnection).not.toHaveBeenCalled();
  });

  test('the suspension refusal is distinguishable from the connection error', async () => {
    standing = 'suspended';
    const suspended = await disconnectOAuthConnection('conn-1');
    standing = 'ok';
    const unknownId = await disconnectOAuthConnection('no-such-connection');
    expect(suspended).not.toEqual(unknownId);
  });

  test('a profiles lookup error does not trap the token — disconnect still proceeds', async () => {
    // SEC-57's softer posture: only a *confirmed* suspension refuses, so a
    // transient read failure cannot stop a user withdrawing consent.
    standing = 'error';
    const res = await disconnectOAuthConnection('conn-1');
    expect(res).toEqual({ ok: true });
    expect(mockDisconnectConnection).toHaveBeenCalledWith('conn-1');
  });

  test('a missing profile row does not block disconnect either', async () => {
    standing = 'missing-row';
    const res = await disconnectOAuthConnection('conn-1');
    expect(res).toEqual({ ok: true });
    expect(mockDisconnectConnection).toHaveBeenCalledWith('conn-1');
  });

  test('surfaces a generic error, not the internal one, if the disconnect throws', async () => {
    mockDisconnectConnection.mockImplementation(async () => {
      throw new Error('disconnect update failed: relation does not exist');
    });
    const res = await disconnectOAuthConnection('conn-1');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).not.toContain('relation');
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});
