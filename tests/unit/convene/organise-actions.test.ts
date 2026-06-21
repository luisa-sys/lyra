/**
 * KAN-305 — unit tests for the Organise-event wizard server actions.
 *
 * createGatheringDraft (ported insert), getHostBusyTimes (host free/busy), and
 * suggestVenues (real scoreVenue over a mocked catalogue). The RLS client,
 * service-role admin client, moderation, calendar adapter and oauth-connection
 * lookup are mocked; scoreVenue runs for real.
 */

// ── Mutable mock state ─────────────────────────────────────
let mockUserId: string | null = 'host-1';
let ownedRows: { id: string }[] = [{ id: 'c1' }, { id: 'c2' }];
let venuesData: Record<string, unknown>[] = [];
let gatheringInsertResult: { data: { id: string } | null; error: unknown } = {
  data: { id: 'g-1' },
  error: null,
};
let moderationResult: { ok: true } | { ok: false; error: string } = { ok: true };
let connResult: { id: string } | null = { id: 'conn-1' };
let freeBusyResult: { start: string; end: string }[] = [{ start: '2026-07-01T10:00:00Z', end: '2026-07-01T11:00:00Z' }];

const captured = {
  gatheringInsert: [] as Record<string, unknown>[],
  slotsInsert: [] as unknown[],
  inviteesInsert: [] as unknown[],
  eventsInsert: [] as Record<string, unknown>[],
};

function rlsChain(table: string) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'in', 'is', 'ilike', 'eq', 'order', 'limit']) chain[m] = () => chain;
  chain.then = (res: (v: unknown) => unknown) =>
    res(table === 'venues' ? { data: venuesData, error: null } : { data: ownedRows, error: null });
  return chain;
}

jest.mock('@/lib/supabase-server', () => ({
  createClient: jest.fn(async () => ({
    auth: { getUser: jest.fn(async () => ({ data: { user: mockUserId ? { id: mockUserId } : null } })) },
    from: jest.fn((t: string) => rlsChain(t)),
  })),
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: (table: string) => ({
      insert: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
        if (table === 'gatherings') {
          captured.gatheringInsert.push(rows as Record<string, unknown>);
          return { select: () => ({ single: async () => gatheringInsertResult }) };
        }
        if (table === 'gathering_proposed_slots') captured.slotsInsert.push(rows);
        if (table === 'gathering_invitees') captured.inviteesInsert.push(rows);
        if (table === 'gathering_events_log') captured.eventsInsert.push(rows as Record<string, unknown>);
        return Promise.resolve({ error: null });
      },
    }),
  })),
}));

jest.mock('@/lib/env', () => ({
  env: {
    supabaseUrl: () => 'http://localhost',
    supabaseServiceRoleKey: () => 'service-role',
    supabaseAnonKey: () => 'anon',
  },
}));

const mockModerate = jest.fn();
jest.mock('@/lib/moderation-audit', () => ({
  moderateAndAudit: (...args: unknown[]) => mockModerate(...args),
}));

const mockGetConn = jest.fn();
jest.mock('@/lib/convene/oauth-connections', () => ({
  getConnectionForUser: (...args: unknown[]) => mockGetConn(...args),
}));

jest.mock('@/lib/convene/calendar', () => ({
  adapterFor: () => ({ getFreeBusy: async () => freeBusyResult }),
}));

import { createGatheringDraft, getHostBusyTimes, suggestVenues } from '@/app/dashboard/convene/organise/actions';

beforeEach(() => {
  mockUserId = 'host-1';
  ownedRows = [{ id: 'c1' }, { id: 'c2' }];
  venuesData = [];
  gatheringInsertResult = { data: { id: 'g-1' }, error: null };
  moderationResult = { ok: true };
  connResult = { id: 'conn-1' };
  freeBusyResult = [{ start: '2026-07-01T10:00:00Z', end: '2026-07-01T11:00:00Z' }];
  captured.gatheringInsert = [];
  captured.slotsInsert = [];
  captured.inviteesInsert = [];
  captured.eventsInsert = [];
  mockModerate.mockImplementation(async () => moderationResult);
  mockGetConn.mockImplementation(async () => connResult);
});

describe('createGatheringDraft', () => {
  const base = {
    title: 'Coffee with the team',
    gathering_type: 'coffee' as const,
    invitee_contact_ids: ['c1', 'c2'],
    proposed_slots: [{ slot_start_iso: '2026-07-02T10:00:00Z', slot_end_iso: '2026-07-02T11:00:00Z' }],
  };

  test('creates a draft stamped with host_user_id and writes slots/invitees/audit', async () => {
    const res = await createGatheringDraft(base);
    expect(res).toEqual({ ok: true, gatheringId: 'g-1' });
    expect(captured.gatheringInsert[0].host_user_id).toBe('host-1');
    expect(captured.gatheringInsert[0].status).toBe('draft');
    expect(captured.gatheringInsert[0].title).toBe('Coffee with the team');
    expect(captured.slotsInsert).toHaveLength(1);
    expect(captured.inviteesInsert).toHaveLength(1);
    expect(captured.eventsInsert[0].event_type).toBe('gathering_created');
  });

  test('rejects an empty title', async () => {
    const res = await createGatheringDraft({ ...base, title: '  ' });
    expect(res.ok).toBe(false);
    expect(captured.gatheringInsert).toHaveLength(0);
  });

  test('rejects an invalid gathering type', async () => {
    const res = await createGatheringDraft({ ...base, gathering_type: 'banquet' as never });
    expect(res.ok).toBe(false);
  });

  test('rejects capacity_max < capacity_min', async () => {
    const res = await createGatheringDraft({ ...base, capacity_min: 5, capacity_max: 2 });
    expect(res.ok).toBe(false);
  });

  test('rejects a slot that ends before it starts', async () => {
    const res = await createGatheringDraft({
      ...base,
      proposed_slots: [{ slot_start_iso: '2026-07-02T11:00:00Z', slot_end_iso: '2026-07-02T10:00:00Z' }],
    });
    expect(res.ok).toBe(false);
  });

  test('rejects when an invitee is not owned by the host', async () => {
    ownedRows = [{ id: 'c1' }]; // c2 missing
    const res = await createGatheringDraft(base);
    expect(res.ok).toBe(false);
    expect(captured.gatheringInsert).toHaveLength(0);
  });

  test('blocks on a moderation failure', async () => {
    moderationResult = { ok: false, error: 'blocked text' };
    const res = await createGatheringDraft(base);
    expect(res.ok).toBe(false);
    expect(captured.gatheringInsert).toHaveLength(0);
  });

  test('rejects unauthenticated callers', async () => {
    mockUserId = null;
    const res = await createGatheringDraft(base);
    expect(res.ok).toBe(false);
  });
});

describe('getHostBusyTimes', () => {
  const win = ['2026-07-01T00:00:00Z', '2026-07-03T00:00:00Z'] as const;

  test('returns busy blocks for a connected calendar', async () => {
    const res = await getHostBusyTimes(win[0], win[1]);
    expect(res).toEqual({ ok: true, connected: true, busy: freeBusyResult });
  });

  test('reports not-connected with a helpful note when no calendar is linked', async () => {
    connResult = null;
    const res = await getHostBusyTimes(win[0], win[1]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.connected).toBe(false);
      expect(res.note).toBeTruthy();
    }
  });

  test('rejects an end before start', async () => {
    const res = await getHostBusyTimes(win[1], win[0]);
    expect(res.ok).toBe(false);
  });

  test('rejects a window longer than 14 days', async () => {
    const res = await getHostBusyTimes('2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z');
    expect(res.ok).toBe(false);
  });

  test('rejects unauthenticated callers', async () => {
    mockUserId = null;
    const res = await getHostBusyTimes(win[0], win[1]);
    expect(res.ok).toBe(false);
  });
});

describe('suggestVenues', () => {
  test('ranks the catalogue with the real scoreVenue engine', async () => {
    venuesData = [
      {
        id: 'v1',
        name: 'The Daily Grind',
        venue_type: 'cafe',
        city: 'Crawley',
        postcode: 'RH10',
        lat: '51.1',
        lng: '-0.18',
        price_tier: 1,
        capacity_estimate: 20,
        accessibility_flags: ['step_free'],
        dietary_flags: ['vegan'],
        external_rating: '4.5',
      },
      {
        id: 'v2',
        name: 'Tiny Room',
        venue_type: 'cafe',
        city: 'Crawley',
        postcode: 'RH10',
        lat: null,
        lng: null,
        price_tier: 2,
        capacity_estimate: 2,
        accessibility_flags: [],
        dietary_flags: [],
        external_rating: null,
      },
    ];
    const res = await suggestVenues({ intent: 'coffee', anchor: 'Crawley', capacityRequired: 0 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(Array.isArray(res.venues)).toBe(true);
      expect(res.venues.map((v) => v.name)).toContain('The Daily Grind');
      for (const v of res.venues) expect(v.score).toBeGreaterThanOrEqual(0);
    }
  });

  test('hard-filters venues below the required capacity', async () => {
    venuesData = [
      { id: 'v2', name: 'Tiny Room', venue_type: 'cafe', city: 'Crawley', postcode: null, lat: null, lng: null, price_tier: 2, capacity_estimate: 2, accessibility_flags: [], dietary_flags: [], external_rating: null },
    ];
    const res = await suggestVenues({ intent: 'party', anchor: null, capacityRequired: 50 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.venues).toHaveLength(0);
  });

  test('rejects an invalid intent', async () => {
    const res = await suggestVenues({ intent: 'banquet' as never });
    expect(res.ok).toBe(false);
  });

  test('rejects unauthenticated callers', async () => {
    mockUserId = null;
    const res = await suggestVenues({ intent: 'coffee' });
    expect(res.ok).toBe(false);
  });
});
