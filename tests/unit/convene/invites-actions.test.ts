/**
 * KAN-306 — unit tests for the gathering "initiate" server actions:
 * finaliseGathering, sendInvites (queue + dedup + drain), resendInvite,
 * cancelInvite. The admin client, RLS session, invite repository and the
 * dispatcher are mocked; applyTransition runs for real.
 */

// ── Mutable mock state ─────────────────────────────────────
let mockUserId: string | null = 'host-1';
let gatheringRow: Record<string, unknown> | null = {
  id: 'g1',
  status: 'draft',
  finalised_slot_start: null as string | null,
};
let inviteeRows: { id: string; status: string }[] = [
  { id: 'i1', status: 'invited' },
  { id: 'i2', status: 'invited' },
];
let inviteeSingle: Record<string, unknown> | null = { id: 'i1', gathering_id: 'g1', status: 'invited' };
let messageRows: { invitee_id: string; delivery_status: string }[] = [];
let venueRow: { id: string } | null = { id: 'v1' };
let updateError: unknown = null;

const captured = {
  gatheringUpdate: [] as Record<string, unknown>[],
  inviteeUpdate: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
};

function adminFrom(table: string) {
  if (table === 'gatherings') {
    return {
      select: () => {
        const c: Record<string, unknown> = {};
        c.eq = () => c;
        c.is = () => c;
        c.maybeSingle = async () => ({ data: gatheringRow, error: null });
        c.single = async () => ({ data: gatheringRow, error: null });
        return c;
      },
      update: (vals: Record<string, unknown>) => {
        captured.gatheringUpdate.push(vals);
        const c: Record<string, unknown> = {};
        c.eq = () => c;
        c.then = (r: (v: unknown) => unknown) => r({ error: updateError });
        return c;
      },
    };
  }
  if (table === 'venues') {
    return {
      select: () => {
        const c: Record<string, unknown> = {};
        c.eq = () => c;
        c.maybeSingle = async () => ({ data: venueRow, error: null });
        return c;
      },
    };
  }
  if (table === 'gathering_invitees') {
    return {
      select: () => {
        const c: Record<string, unknown> = {};
        c.eq = () => c;
        c.maybeSingle = async () => ({ data: inviteeSingle, error: null });
        c.then = (r: (v: unknown) => unknown) => r({ data: inviteeRows, error: null });
        return c;
      },
      update: (vals: Record<string, unknown>) => {
        captured.inviteeUpdate.push(vals);
        const c: Record<string, unknown> = {};
        c.eq = () => c;
        c.then = (r: (v: unknown) => unknown) => r({ error: updateError });
        return c;
      },
    };
  }
  if (table === 'gathering_invite_messages') {
    return {
      select: () => {
        const c: Record<string, unknown> = {};
        c.eq = () => c;
        c.then = (r: (v: unknown) => unknown) => r({ data: messageRows, error: null });
        return c;
      },
    };
  }
  if (table === 'gathering_events_log') {
    return { insert: (row: Record<string, unknown>) => (captured.events.push(row), Promise.resolve({ error: null })) };
  }
  return { select: () => ({ then: (r: (v: unknown) => unknown) => r({ data: [], error: null }) }) };
}

jest.mock('@/lib/supabase-server', () => ({
  createClient: jest.fn(async () => ({
    auth: { getUser: jest.fn(async () => ({ data: { user: mockUserId ? { id: mockUserId } : null } })) },
  })),
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ from: (t: string) => adminFrom(t) })),
}));

jest.mock('@/lib/env', () => ({
  env: { supabaseUrl: () => 'http://localhost', supabaseServiceRoleKey: () => 'svc', supabaseAnonKey: () => 'anon' },
}));

const mockPersist = jest.fn(async () => ({ id: 'm1' }));
const mockSetToken = jest.fn(async () => undefined);
jest.mock('@/lib/convene/invites/repository', () => ({
  generateRsvpToken: () => 'tok',
  persistQueuedInvite: (...a: unknown[]) => mockPersist(...(a as [])),
  setInviteeRsvpToken: (...a: unknown[]) => mockSetToken(...(a as [])),
}));

const mockDispatch = jest.fn(async () => ({
  scanned: 2,
  sent: 0,
  blocked_by_allowlist: 2,
  failed: 0,
  skipped_unfinalised: 0,
  errors: [] as string[],
}));
jest.mock('@/lib/convene/invites/dispatch', () => ({ dispatchQueuedInvites: (...a: unknown[]) => mockDispatch(...(a as [])) }));

jest.mock('@/lib/convene/calendar', () => ({
  adapterFor: () => ({ getFreeBusy: async () => [], createEvent: async () => ({ providerEventId: 'x' }) }),
}));
jest.mock('@/lib/convene/oauth-connections', () => ({ getConnectionForUser: async () => null }));

import {
  finaliseGathering,
  sendInvites,
  resendInvite,
  cancelInvite,
} from '@/app/dashboard/convene/gatherings/[id]/actions';

beforeEach(() => {
  mockUserId = 'host-1';
  gatheringRow = { id: 'g1', status: 'draft', finalised_slot_start: null };
  inviteeRows = [
    { id: 'i1', status: 'invited' },
    { id: 'i2', status: 'invited' },
  ];
  inviteeSingle = { id: 'i1', gathering_id: 'g1', status: 'invited' };
  messageRows = [];
  venueRow = { id: 'v1' };
  updateError = null;
  captured.gatheringUpdate = [];
  captured.inviteeUpdate = [];
  captured.events = [];
  mockPersist.mockClear();
  mockSetToken.mockClear();
  mockDispatch.mockClear();
});

describe('finaliseGathering', () => {
  const start = '2026-07-02T10:00:00Z';
  const end = '2026-07-02T11:00:00Z';

  test('locks a draft to live with the chosen slot', async () => {
    const res = await finaliseGathering('g1', start, end);
    expect(res).toEqual({ ok: true });
    expect(captured.gatheringUpdate[0].status).toBe('live');
    expect(captured.gatheringUpdate[0].finalised_slot_start).toBe(start);
    expect(captured.events[0].event_type).toBe('gathering_finalised');
  });

  test('rejects an end before start', async () => {
    const res = await finaliseGathering('g1', end, start);
    expect(res.ok).toBe(false);
    expect(captured.gatheringUpdate).toHaveLength(0);
  });

  test('rejects finalise from a non-draft state', async () => {
    gatheringRow = { id: 'g1', status: 'live', finalised_slot_start: start };
    const res = await finaliseGathering('g1', start, end);
    expect(res.ok).toBe(false);
  });

  test('rejects unauthenticated callers', async () => {
    mockUserId = null;
    const res = await finaliseGathering('g1', start, end);
    expect(res.ok).toBe(false);
  });
});

describe('sendInvites', () => {
  beforeEach(() => {
    gatheringRow = { id: 'g1', status: 'live', finalised_slot_start: '2026-07-02T10:00:00Z' };
  });

  test('queues every active invitee then drains, returning a summary', async () => {
    const res = await sendInvites('g1');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.summary.queued).toBe(2);
      expect(res.summary.blocked_by_allowlist).toBe(2);
    }
    expect(mockPersist).toHaveBeenCalledTimes(2);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  test('dedups invitees that already have a live message', async () => {
    messageRows = [{ invitee_id: 'i1', delivery_status: 'sent' }];
    const res = await sendInvites('g1');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.summary.queued).toBe(1);
    expect(mockPersist).toHaveBeenCalledTimes(1);
  });

  test('refuses to send before the gathering is finalised', async () => {
    gatheringRow = { id: 'g1', status: 'draft', finalised_slot_start: null };
    const res = await sendInvites('g1');
    expect(res.ok).toBe(false);
    expect(mockPersist).not.toHaveBeenCalled();
  });

  test('errors when there is no one left to invite', async () => {
    inviteeRows = [{ id: 'i1', status: 'cancelled' }];
    const res = await sendInvites('g1');
    expect(res.ok).toBe(false);
  });

  test('rejects unauthenticated callers', async () => {
    mockUserId = null;
    const res = await sendInvites('g1');
    expect(res.ok).toBe(false);
  });
});

describe('resendInvite', () => {
  beforeEach(() => {
    gatheringRow = { id: 'g1', status: 'live', finalised_slot_start: '2026-07-02T10:00:00Z' };
  });

  test('re-queues a single invitee and drains', async () => {
    const res = await resendInvite('i1');
    expect(res).toEqual({ ok: true });
    expect(mockPersist).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  test('refuses to resend a cancelled invite', async () => {
    inviteeSingle = { id: 'i1', gathering_id: 'g1', status: 'cancelled' };
    const res = await resendInvite('i1');
    expect(res.ok).toBe(false);
    expect(mockPersist).not.toHaveBeenCalled();
  });

  test('rejects unauthenticated callers', async () => {
    mockUserId = null;
    const res = await resendInvite('i1');
    expect(res.ok).toBe(false);
  });
});

describe('cancelInvite', () => {
  test('marks the invitee cancelled and clears its token', async () => {
    const res = await cancelInvite('i1');
    expect(res).toEqual({ ok: true });
    expect(captured.inviteeUpdate[0].status).toBe('cancelled');
    expect(captured.inviteeUpdate[0].rsvp_token).toBeNull();
    expect(captured.events[0].event_type).toBe('invitee_cancelled');
  });

  test('errors when the invite is not found', async () => {
    inviteeSingle = null;
    const res = await cancelInvite('ghost');
    expect(res.ok).toBe(false);
    expect(captured.inviteeUpdate).toHaveLength(0);
  });

  test('rejects unauthenticated callers', async () => {
    mockUserId = null;
    const res = await cancelInvite('i1');
    expect(res.ok).toBe(false);
  });
});
