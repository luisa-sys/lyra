/**
 * SEC-81 / SEC-57 — defence-in-depth: the invite dispatcher must refuse to
 * drain a suspended host's queued invites on the per-host path (the path used
 * by the web `sendInvites`/`resendInvite` actions and by the MCP
 * `lyra_drain_invite_queue` tool). Fail CLOSED: a standing-lookup error also
 * refuses. The global cron drain (no hostUserId) keeps its existing behaviour.
 *
 * This file mocks the Supabase client just enough to exercise the new early
 * guard; the real getAccountStanding/shouldRefuseIssuance helpers run against
 * the mock. The happy path uses a host with zero gatherings so the dispatcher
 * returns immediately after the standing check without touching the send path.
 */

// ── Mutable mock state ─────────────────────────────────────
let profileRow: Record<string, unknown> | null = { is_suspended: false };
let profileError: unknown = null;
let gatheringIds: { id: string }[] = [];
const calls = { gatheringsQueried: false, messagesQueried: false };

function makeQuery(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.eq = () => c;
  c.is = () => c;
  c.in = () => c;
  c.order = () => c;
  c.limit = () => c;
  c.update = () => c;
  c.lt = () => c;
  c.maybeSingle = async () => result;
  // Thenable so `await sb.from(...).select(...).eq(...).is(...)` resolves.
  c.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return c;
}

function fromImpl(table: string) {
  if (table === 'profiles') return makeQuery({ data: profileRow, error: profileError });
  if (table === 'gatherings') {
    calls.gatheringsQueried = true;
    return makeQuery({ data: gatheringIds, error: null });
  }
  if (table === 'gathering_invite_messages') {
    calls.messagesQueried = true;
    return makeQuery({ data: [], error: null });
  }
  return makeQuery({ data: [], error: null });
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ from: (t: string) => fromImpl(t) })),
}));

jest.mock('@/lib/env', () => ({
  env: { supabaseUrl: () => 'http://localhost', supabaseServiceRoleKey: () => 'svc', supabaseAnonKey: () => 'anon' },
}));

import { dispatchQueuedInvites } from '@/lib/convene/invites/dispatch';

beforeEach(() => {
  profileRow = { is_suspended: false };
  profileError = null;
  gatheringIds = [];
  calls.gatheringsQueried = false;
  calls.messagesQueried = false;
});

describe('dispatchQueuedInvites — SEC-81 suspended-host guard', () => {
  test('refuses a suspended host before scanning the queue', async () => {
    profileRow = { is_suspended: true };
    const summary = await dispatchQueuedInvites({ hostUserId: 'host-suspended' });
    expect(summary.scanned).toBe(0);
    expect(summary.sent).toBe(0);
    expect(summary.errors.join(' ')).toMatch(/suspended/i);
    // Guard short-circuits before any gathering/message scan.
    expect(calls.gatheringsQueried).toBe(false);
    expect(calls.messagesQueried).toBe(false);
  });

  test('fails closed when the standing lookup errors', async () => {
    profileError = { message: 'transient read failure' };
    profileRow = null;
    const summary = await dispatchQueuedInvites({ hostUserId: 'host-unknown' });
    expect(summary.errors.join(' ')).toMatch(/suspended/i);
    expect(calls.gatheringsQueried).toBe(false);
  });

  test('fails closed when the host has no profile row', async () => {
    profileRow = null;
    const summary = await dispatchQueuedInvites({ hostUserId: 'host-noprofile' });
    expect(summary.errors.join(' ')).toMatch(/suspended/i);
    expect(calls.gatheringsQueried).toBe(false);
  });

  test('a good-standing host passes the guard and proceeds to scan', async () => {
    profileRow = { is_suspended: false };
    gatheringIds = []; // no gatherings → dispatcher returns after the scan
    const summary = await dispatchQueuedInvites({ hostUserId: 'host-ok' });
    expect(summary.errors).toHaveLength(0);
    // Passed the standing check and reached the per-host gathering scan.
    expect(calls.gatheringsQueried).toBe(true);
  });

  test('global cron drain (no hostUserId) does not invoke the standing check', async () => {
    // With no hostUserId, the guard block is skipped entirely and the global
    // queue scan runs. profiles must never be consulted on this path.
    profileRow = { is_suspended: true }; // would refuse IF it were consulted
    const summary = await dispatchQueuedInvites({});
    // No per-host refusal error was emitted → the guard was not applied.
    expect(summary.errors.join(' ')).not.toMatch(/suspended/i);
    expect(calls.messagesQueried).toBe(true);
  });
});
