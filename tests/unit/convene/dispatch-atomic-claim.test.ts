/**
 * BUGS-62 — Convene invite dispatcher: atomic queue claim.
 *
 * The dispatcher previously read 'queued' rows and only marked them 'sent'
 * AFTER the provider call, so two overlapping runs (10-min cron + a manual
 * drain, or two crons on a slow provider) could both read the same row and
 * send the invite twice. The fix claims rows atomically — flip 'queued' ->
 * 'sending' guarded by delivery_status='queued', process only the RETURNed
 * rows — so each queued invite is owned (and sent) by at most one run.
 *
 * This suite proves the claim primitive is race-safe with an in-memory fake
 * whose UPDATE honours the `delivery_status='queued'` guard (the same guard
 * Postgres enforces via row locks), then adds static guards for the wiring
 * that has to move in lockstep with the new transient 'sending' state.
 */

import fs from 'fs';
import path from 'path';
import { _internal } from '@/lib/convene/invites/dispatch';
import { SRC } from '../../support/source-paths';

const { claimQueuedRows, releaseClaim } = _internal as unknown as {
  claimQueuedRows: (
    sb: unknown,
    ids: string[],
    nowIso: string
  ) => Promise<Array<{ id: string }>>;
  releaseClaim: (sb: unknown, id: string) => Promise<void>;
};

const ROOT = path.join(__dirname, '..', '..', '..');

interface Row {
  id: string;
  gathering_id: string;
  invitee_id: string;
  channel: string;
  template_name: string;
  delivery_status: string;
  claimed_at: string | null;
}

function makeRow(id: string, status = 'queued'): Row {
  return {
    id,
    gathering_id: `g-${id}`,
    invitee_id: `i-${id}`,
    channel: 'email',
    template_name: 'convene-invite',
    delivery_status: status,
    claimed_at: null,
  };
}

/**
 * Minimal fake Supabase client modelling the exact filter-builder surface the
 * claim/release helpers use: .update(patch).in('id', ids).eq(col, val)[.select()].
 * The UPDATE applies the patch ONLY to rows matching every filter, atomically
 * (synchronously) — so a second claim over the same rows, after the first
 * flipped them to 'sending', sees delivery_status !== 'queued' and matches none.
 */
function makeFake(rows: Row[]) {
  function builder() {
    let patch: Partial<Row> | null = null;
    const filters: Array<{ kind: 'in' | 'eq'; col: keyof Row; a: unknown }> = [];
    let selecting = false;

    const run = () => {
      const matched = rows.filter((r) =>
        filters.every((f) =>
          f.kind === 'in'
            ? (f.a as string[]).includes(r[f.col] as string)
            : r[f.col] === f.a
        )
      );
      if (patch) for (const r of matched) Object.assign(r, patch);
      return { data: selecting ? matched.map((r) => ({ ...r })) : null, error: null };
    };

    const api = {
      update(p: Partial<Row>) {
        patch = p;
        return api;
      },
      in(col: keyof Row, a: string[]) {
        filters.push({ kind: 'in', col, a });
        return api;
      },
      eq(col: keyof Row, a: unknown) {
        filters.push({ kind: 'eq', col, a });
        return api;
      },
      select() {
        selecting = true;
        return api;
      },
      then(resolve: (v: { data: unknown; error: unknown }) => void) {
        resolve(run());
      },
    };
    return api;
  }
  return { from: () => builder() };
}

describe('claimQueuedRows — atomic claim (BUGS-62)', () => {
  test('claims each queued row exactly once across two overlapping runs', async () => {
    const rows = ['r1', 'r2', 'r3', 'r4'].map((id) => makeRow(id));
    const sb = makeFake(rows);

    // Both runs read all four as candidates while every row is still 'queued'
    // (the pre-claim SELECT), with overlapping batches — the worst case.
    const run1Candidates = ['r1', 'r2', 'r3'];
    const run2Candidates = ['r2', 'r3', 'r4'];

    const claimed1 = await claimQueuedRows(sb, run1Candidates, '2026-07-06T15:00:00Z');
    const claimed2 = await claimQueuedRows(sb, run2Candidates, '2026-07-06T15:00:01Z');

    const ids1 = claimed1.map((r) => r.id).sort();
    const ids2 = claimed2.map((r) => r.id).sort();

    // No row is claimed by both runs — the invariant that prevents double-send.
    const overlap = ids1.filter((id) => ids2.includes(id));
    expect(overlap).toEqual([]);

    // Every originally-queued row is claimed by exactly one run (nothing lost).
    expect([...ids1, ...ids2].sort()).toEqual(['r1', 'r2', 'r3', 'r4']);

    // First run wins the contested rows; second run only gets the uncontested one.
    expect(ids1).toEqual(['r1', 'r2', 'r3']);
    expect(ids2).toEqual(['r4']);

    // Claimed rows are flipped to the transient 'sending' state with a stamp.
    expect(rows.every((r) => r.delivery_status === 'sending')).toBe(true);
    expect(rows.find((r) => r.id === 'r1')!.claimed_at).toBe('2026-07-06T15:00:00Z');
  });

  test('empty id list claims nothing (no UPDATE issued)', async () => {
    const rows = [makeRow('r1')];
    const claimed = await claimQueuedRows(makeFake(rows), [], '2026-07-06T15:00:00Z');
    expect(claimed).toEqual([]);
    expect(rows[0].delivery_status).toBe('queued');
  });

  test('a row already claimed by another run is not re-claimed', async () => {
    const rows = [makeRow('r1', 'sending'), makeRow('r2', 'queued')];
    const claimed = await claimQueuedRows(makeFake(rows), ['r1', 'r2'], '2026-07-06T15:00:00Z');
    expect(claimed.map((r) => r.id)).toEqual(['r2']);
  });

  test('releaseClaim returns a claimed row to queued so it can be claimed again', async () => {
    const rows = [makeRow('r1', 'sending')];
    rows[0].claimed_at = '2026-07-06T15:00:00Z';
    const sb = makeFake(rows);

    await releaseClaim(sb, 'r1');
    expect(rows[0].delivery_status).toBe('queued');
    expect(rows[0].claimed_at).toBeNull();

    const reclaimed = await claimQueuedRows(sb, ['r1'], '2026-07-06T15:05:00Z');
    expect(reclaimed.map((r) => r.id)).toEqual(['r1']);
  });
});

// ─── static guards: the wiring that must move with the 'sending' state ──────

describe('dispatch.ts claim wiring (BUGS-62)', () => {
  const src = fs.readFileSync(path.join(ROOT, SRC.dispatch), 'utf8');

  test('claim UPDATE is guarded by delivery_status=queued', () => {
    expect(src).toMatch(/delivery_status:\s*'sending'/);
    // the guard predicate on the claim update
    expect(src).toMatch(/\.eq\('delivery_status',\s*'queued'\)\s*\n\s*\.select\(CLAIM_COLUMNS\)/);
  });

  test('transient failure paths release the claim (not left in sending)', () => {
    // not_finalised and not_in_allowlist both re-queue via releaseClaim.
    const notFinalised = src.indexOf("loaded.reason === 'not_finalised'");
    const allowlist = src.indexOf("result.code === 'not_in_allowlist'");
    expect(notFinalised).toBeGreaterThan(-1);
    expect(allowlist).toBeGreaterThan(-1);
    expect(src.slice(notFinalised, notFinalised + 200)).toMatch(/releaseClaim\(sb, row\.id\)/);
    expect(src.slice(allowlist, allowlist + 200)).toMatch(/releaseClaim\(sb, row\.id\)/);
  });

  test('stale sending rows are reclaimed to queued before claiming', () => {
    expect(src).toMatch(/delivery_status:\s*'queued',\s*claimed_at:\s*null/);
    expect(src).toMatch(/STALE_CLAIM_MINUTES/);
  });

  test('per-host gathering scoping is preserved (drain isolation)', () => {
    expect(src).toMatch(/\.eq\('host_user_id',\s*opts\.hostUserId\)/);
    expect(src).toMatch(/\.in\('gathering_id'/);
  });
});

describe('schema + re-queue guards move with the state (BUGS-62)', () => {
  test('migration widens the delivery_status CHECK to include sending + adds claimed_at', () => {
    const mig = fs.readFileSync(
      path.join(ROOT, SRC.migrations20260706153000Bugs62ConveneInviteAtomicClaim),
      'utf8'
    );
    expect(mig).toMatch(/'queued',\s*'sending',\s*'sent'/);
    expect(mig).toMatch(/add column if not exists claimed_at timestamptz/);
  });

  test('web re-queue treats sending as an already-live message', () => {
    const actions = fs.readFileSync(
      path.join(ROOT, SRC.idActions),
      'utf8'
    );
    expect(actions).toMatch(/\['queued',\s*'sending',\s*'sent'/);
  });
});
