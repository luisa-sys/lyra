/**
 * SEC-82 (item 1) — POST /api/reports must verify that a supplied
 * `profileItemId` actually belongs to the target profile before inserting the
 * report. `profileItemId` is only UUID-shape-validated; without the ownership
 * check a reporter could attach an item id from a *different* profile,
 * producing a mismatched moderation row (profile_id=A, profile_item_id=B).
 *
 * Behavioural: a mismatched item id is rejected (400 item_not_on_profile) and
 * NO report row is inserted; a matching item id (and the no-item case) insert
 * normally.
 */

const mockGetUser = jest.fn();

// Mutable fixtures the admin-service mock reads.
let profileRow: { id: string; user_id: string } | null;
let itemRow: { id: string; profile_id: string } | null;
let recentCount: number;
const insertSpy = jest.fn();
let insertResult: { data: { id: string; status: string } | null; error: { message: string } | null };

jest.mock('@/modules/platform/supabase-server', () => ({
  createClient: async () => ({
    auth: { getUser: (...a: unknown[]) => mockGetUser(...a) },
  }),
}));

jest.mock('@/lib/admin', () => ({
  getAdminServiceClient: () => ({
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profileRow }) }) }),
        };
      }
      if (table === 'profile_items') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: itemRow }) }) }),
        };
      }
      // reports — used for both the rate-limit head-count and the insert.
      return {
        select: (_cols: string, opts?: { head?: boolean }) => {
          if (opts && opts.head) {
            return { eq: () => ({ eq: () => ({ gte: async () => ({ count: recentCount }) }) }) };
          }
          return { single: async () => insertResult };
        },
        insert: (payload: Record<string, unknown>) => {
          insertSpy(payload);
          return { select: () => ({ single: async () => insertResult }) };
        },
      };
    },
  }),
}));

import { POST } from '@/app/api/reports/route';

function req(body: unknown): Request {
  return new Request('http://localhost/api/reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'reporter-1' } } });
  profileRow = { id: 'profile-A', user_id: 'owner-A' };
  itemRow = { id: 'item-1', profile_id: 'profile-A' };
  recentCount = 0;
  insertResult = { data: { id: 'report-1', status: 'pending' }, error: null };
});

describe('SEC-82: reports profileItemId ownership', () => {
  it('rejects a profileItemId that belongs to a different profile (no insert)', async () => {
    itemRow = { id: 'item-1', profile_id: 'profile-B' }; // belongs to someone else
    const res = await POST(req({ profileSlug: 'a', profileItemId: '11111111-1111-1111-1111-111111111111', reason: 'spam' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'item_not_on_profile' });
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects a profileItemId that does not exist (no insert)', async () => {
    itemRow = null;
    const res = await POST(req({ profileSlug: 'a', profileItemId: '11111111-1111-1111-1111-111111111111', reason: 'spam' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'item_not_on_profile' });
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('accepts a profileItemId that belongs to the target profile', async () => {
    itemRow = { id: 'item-1', profile_id: 'profile-A' };
    const res = await POST(req({ profileSlug: 'a', profileItemId: '11111111-1111-1111-1111-111111111111', reason: 'spam' }));
    expect(res.status).toBe(201);
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(insertSpy.mock.calls[0][0]).toMatchObject({ profile_id: 'profile-A' });
  });

  it('accepts a report with no profileItemId (item check skipped)', async () => {
    const res = await POST(req({ profileSlug: 'a', reason: 'spam' }));
    expect(res.status).toBe(201);
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(insertSpy.mock.calls[0][0]).toMatchObject({ profile_id: 'profile-A', profile_item_id: null });
  });
});
