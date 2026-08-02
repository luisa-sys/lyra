/**
 * KAN-414 F4 (KAN-417 §8 group 3) — behavioural replacement for the source-text
 * scans in tests/unit/convene/post-event.test.ts.
 *
 * THE INVARIANTS, IN WORDS
 * ------------------------
 *  1. Only NON-TERMINAL gatherings are swept. Sweeping a cancelled or already
 *     completed gathering would rewrite settled history.
 *  2. A 2-hour buffer past `finalised_slot_end` — an event is not "over" the
 *     instant its end time passes, and completing it early would mark attendees
 *     for something still happening.
 *  3. Each swept gathering is marked `completed` AND gets a
 *     `gathering_completed` audit row. The audit is not decoration: it is how
 *     anyone later reconstructs why a gathering changed state.
 *  4. Only ACCEPTED invitees flip to `attended` — never declined or pending.
 *     Recording someone as having attended an event they declined is a data
 *     integrity fault with real user-facing consequences.
 *  5. The relationship-signals materialised view is refreshed afterwards.
 *
 * WHY THIS IS STRONGER
 * --------------------
 * The old block regexed the source for shapes like
 * `/\.eq\(\s*['"]status['"]\s*,\s*['"]accepted['"]\s*\)/`. That proves the
 * characters exist somewhere in the file — not that the filter is applied to the
 * invitee update rather than to some other query, and not that the buffer is
 * subtracted rather than added. Both are one-character mistakes the regex would
 * sail past.
 *
 * MUTATION PROOF (2026-07-31, each reverted)
 *   * change the invitee filter from 'accepted' to 'pending' -> case 4 reddens
 *   * flip the buffer from `Date.now() - …` to `+ …`          -> case 2 reddens
 *   * drop the audit-log insert                               -> case 3 reddens
 * Every original regex still matches under the first two, because the literals
 * are all still present in the file.
 */
import { runPostEventSweep } from '@/lib/convene/post-event';

type Call = { table: string; op: string; args: unknown[] };
const calls: Call[] = [];

/**
 * A chainable Supabase stub that RECORDS what was asked of it.
 *
 * Deliberately records rather than asserting inline: the interesting claims are
 * about which filters landed on WHICH table, and that is far clearer read back
 * at the end than tangled up in a mock.
 */
function makeClient(rows: unknown[]) {
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    const rec = (op: string) => (...args: unknown[]) => {
      calls.push({ table, op, args });
      return self;
    };
    for (const op of ['select', 'in', 'not', 'lt', 'is', 'order', 'eq', 'update', 'insert']) {
      self[op] = rec(op);
    }
    // `limit` terminates the read chain and resolves.
    self.limit = (...args: unknown[]) => {
      calls.push({ table, op: 'limit', args });
      return Promise.resolve({ data: rows, error: null });
    };
    // Awaiting an update/insert chain resolves to no error.
    self.then = (resolve: (v: unknown) => unknown) => resolve({ error: null });
    return self;
  };
  return {
    from: (table: string) => chain(table),
    rpc: (name: string, ...args: unknown[]) => {
      calls.push({ table: '(rpc)', op: name, args });
      return Promise.resolve({ error: null });
    },
  };
}

const GATHERING = {
  id: 'g-1',
  host_user_id: 'host-1',
  status: 'live',
  finalised_slot_end: '2026-01-01T10:00:00.000Z',
  title: 'Dinner',
};

jest.mock('@/lib/supabase-service', () => ({
  createServiceRoleClient: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createServiceRoleClient } = require('@/lib/supabase-service');

function argsFor(table: string, op: string) {
  return calls.filter((c) => c.table === table && c.op === op).map((c) => c.args);
}

describe('runPostEventSweep (behavioural, KAN-414 F4)', () => {
  beforeEach(() => {
    calls.length = 0;
    (createServiceRoleClient as jest.Mock).mockReturnValue(makeClient([GATHERING]));
  });

  it('sweeps only non-terminal gatherings', async () => {
    await runPostEventSweep();

    const [statuses] = argsFor('gatherings', 'in')[0] as [string, string[]];
    expect(statuses).toBe('status');
    const values = (argsFor('gatherings', 'in')[0] as [string, string[]])[1];
    expect([...values].sort()).toEqual(['awaiting_responses', 'live', 'rescheduled']);
    // Terminal states must never appear — sweeping them rewrites settled history.
    expect(values).not.toContain('completed');
    expect(values).not.toContain('cancelled');
  });

  it('applies a 2-hour buffer BEFORE now, not after', async () => {
    const before = Date.now();
    await runPostEventSweep();

    const ltArgs = argsFor('gatherings', 'lt')[0] as [string, string];
    expect(ltArgs[0]).toBe('finalised_slot_end');
    const cutoff = new Date(ltArgs[1]).getTime();
    const hours = (before - cutoff) / 3_600_000;
    // A sign flip here would complete events still in progress. Bracketed
    // rather than exact so the test does not race the clock.
    expect(hours).toBeGreaterThan(1.9);
    expect(hours).toBeLessThan(2.1);
  });

  it('marks the gathering completed and writes a gathering_completed audit row', async () => {
    await runPostEventSweep();

    const updates = argsFor('gatherings', 'update').map((a) => a[0] as { status?: string });
    expect(updates.some((u) => u.status === 'completed')).toBe(true);

    const audits = argsFor('gathering_events_log', 'insert').map(
      (a) => a[0] as { event_type?: string },
    );
    expect(audits.some((a) => a.event_type === 'gathering_completed')).toBe(true);
  });

  it('flips ONLY accepted invitees to attended', async () => {
    await runPostEventSweep();

    const inviteeUpdate = argsFor('gathering_invitees', 'update').map(
      (a) => a[0] as { status?: string },
    );
    expect(inviteeUpdate.some((u) => u.status === 'attended')).toBe(true);

    // The filter that matters: marking a declined invitee as "attended" is a
    // data-integrity fault with user-facing consequences.
    const eqs = argsFor('gathering_invitees', 'eq') as [string, string][];
    expect(eqs).toContainEqual(['status', 'accepted']);
    expect(eqs.map(([, v]) => v)).not.toContain('declined');
  });

  it('refreshes the relationship-signals view', async () => {
    await runPostEventSweep();

    expect(calls.some((c) => c.table === '(rpc)' && c.op === 'refresh_relationship_signals'))
      .toBe(true);
  });
});
