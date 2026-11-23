/**
 * KAN-489 — store.ts: the three database calls behind AI gift suggestions,
 * through a per-statement Supabase mock (each `.from()` / `.rpc()` call is
 * its own record, CTL-076). Expected values are literals.
 */

import { claimGeneration, dismissPendingSuggestion, insertSuggestions } from '@/modules/profile/ai-gifts/store';

type Rpc = { fn: string; args: unknown };
type Del = { table: string; eq: Array<[string, unknown]>; select: string | null };
type Read = { table: string; eq: Array<[string, unknown]>; select: string };

function client(opts: {
  rpc?: (fn: string, args: unknown) => { data: unknown; error: unknown };
  deleteResult?: { data: unknown; error: unknown };
  readResult?: { data: unknown; error: unknown };
}) {
  const rpcs: Rpc[] = [];
  const deletes: Del[] = [];
  const reads: Read[] = [];
  const supabase = {
    rpc(fn: string, args: unknown) {
      rpcs.push({ fn, args });
      return Promise.resolve(opts.rpc ? opts.rpc(fn, args) : { data: null, error: null });
    },
    from(table: string) {
      const st: Del = { table, eq: [], select: null };
      let isDelete = false;
      const b = {
        delete() {
          isDelete = true;
          deletes.push(st);
          return b;
        },
        eq(col: string, val: unknown) {
          st.eq.push([col, val]);
          return b;
        },
        select(cols: string) {
          st.select = cols;
          if (isDelete) return Promise.resolve(opts.deleteResult ?? { data: [], error: null });
          // A plain read (the follow-up after a delete that removed nothing).
          const read: Read = { table, eq: st.eq, select: cols };
          reads.push(read);
          return b;
        },
        maybeSingle() {
          return Promise.resolve(opts.readResult ?? { data: null, error: null });
        },
      };
      return b;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { supabase: supabase as any, rpcs, deletes, reads };
}

describe('claimGeneration', () => {
  it('calls claim_ai_gift_generation with p_session + p_consent_version and maps a success', async () => {
    const c = client({ rpc: () => ({ data: { ok: true, generation_id: 'g', session_remaining: 4, daily_remaining: 19 }, error: null }) });
    expect(await claimGeneration(c.supabase, 'sess', 'v-1')).toEqual({ ok: true, sessionRemaining: 4, dailyRemaining: 19 });
    // Was `args: { p_session: 'sess' }` before the review fix recorded consent.
    expect(c.rpcs).toEqual([{ fn: 'claim_ai_gift_generation', args: { p_session: 'sess', p_consent_version: 'v-1' } }]);
  });

  it.each(['session_limit', 'daily_limit', 'cooldown'])('maps the refusal %s with the session count', async (reason) => {
    const c = client({ rpc: () => ({ data: { ok: false, reason, session_remaining: 2 }, error: null }) });
    expect(await claimGeneration(c.supabase, 's', 'v-1')).toEqual({ ok: false, reason, sessionRemaining: 2 });
  });

  it('maps the suspended refusal (no count sent) → suspended with a null count', async () => {
    const c = client({ rpc: () => ({ data: { ok: false, reason: 'suspended' }, error: null }) });
    expect(await claimGeneration(c.supabase, 's', 'v-1')).toEqual({ ok: false, reason: 'suspended', sessionRemaining: null });
  });

  it('an RPC error, a null result, an unknown reason or a malformed success → error (fail closed)', async () => {
    for (const r of [
      { data: null, error: { message: 'x' } },
      { data: null, error: null },
      { data: { ok: false, reason: 'something_else' }, error: null },
      { data: { ok: true, session_remaining: 'four', daily_remaining: 3 }, error: null },
      { data: { ok: 'yes' }, error: null },
    ]) {
      const c = client({ rpc: () => r });
      expect(await claimGeneration(c.supabase, 's', 'v-1')).toEqual({ ok: false, reason: 'error' });
    }
  });
});

describe('insertSuggestions', () => {
  it('sends only title + description and maps the stored rows and the cap overflow', async () => {
    const c = client({
      rpc: () => ({
        data: { inserted: [{ id: 'a', title: 'Kite', description: null }, { id: 'b', title: 'Clay', description: 'Set' }], dropped_for_cap: 1 },
        error: null,
      }),
    });
    const r = await insertSuggestions(c.supabase, [
      { title: 'Kite', description: null },
      { title: 'Clay', description: 'Set' },
      { title: 'Map', description: 'x' },
    ]);
    expect(c.rpcs).toEqual([
      {
        fn: 'insert_ai_gift_suggestions',
        args: {
          p_items: [
            { title: 'Kite', description: null },
            { title: 'Clay', description: 'Set' },
            { title: 'Map', description: 'x' },
          ],
        },
      },
    ]);
    expect(r).toEqual({
      ok: true,
      inserted: [
        { id: 'a', title: 'Kite', description: null },
        { id: 'b', title: 'Clay', description: 'Set' },
      ],
      droppedForCap: 1,
    });
  });

  it('nothing kept → no RPC call', async () => {
    const c = client({});
    expect(await insertSuggestions(c.supabase, [])).toEqual({ ok: true, inserted: [], droppedForCap: 0 });
    expect(c.rpcs).toEqual([]);
  });

  it('an RPC error or a malformed result → not ok', async () => {
    for (const r of [
      { data: null, error: { message: 'Section limit (10) reached' } },
      { data: { inserted: 'x' }, error: null },
      { data: { inserted: [{ id: 1, title: 'x' }] }, error: null },
    ]) {
      const c = client({ rpc: () => r });
      expect(await insertSuggestions(c.supabase, [{ title: 'Kite', description: null }])).toEqual({ ok: false });
    }
  });
});

describe('dismissPendingSuggestion', () => {
  it('deletes ONE unapproved AI row by id', async () => {
    const c = client({ deleteResult: { data: [{ id: 'row-1' }], error: null } });
    expect(await dismissPendingSuggestion(c.supabase, 'row-1')).toEqual({ ok: true });
    expect(c.deletes).toEqual([
      { table: 'profile_items', eq: [['id', 'row-1'], ['origin', 'ai'], ['approved', false]], select: 'id' },
    ]);
    expect(c.reads).toEqual([]); // no follow-up read when the delete worked
  });

  it('no row deleted and the row is gone (a member gift, someone else’s, or already deleted) → not_found', async () => {
    const c = client({ deleteResult: { data: [], error: null }, readResult: { data: null, error: null } });
    expect(await dismissPendingSuggestion(c.supabase, 'row-1')).toEqual({ ok: false, reason: 'not_found' });
    expect(c.reads).toEqual([{ table: 'profile_items', eq: [['id', 'row-1'], ['origin', 'ai']], select: 'id, approved' }]);
  });

  it('review fix — no row deleted because it is already APPROVED (e.g. another tab) → approved_elsewhere', async () => {
    const c = client({ deleteResult: { data: [], error: null }, readResult: { data: { id: 'row-1', approved: true }, error: null } });
    expect(await dismissPendingSuggestion(c.supabase, 'row-1')).toEqual({ ok: false, reason: 'approved_elsewhere' });
  });

  it('no row deleted, the row still pending (deleted concurrently then re-read) → not_found', async () => {
    const c = client({ deleteResult: { data: [], error: null }, readResult: { data: { id: 'row-1', approved: false }, error: null } });
    expect(await dismissPendingSuggestion(c.supabase, 'row-1')).toEqual({ ok: false, reason: 'not_found' });
  });

  it('the follow-up read failing → failed', async () => {
    const c = client({ deleteResult: { data: [], error: null }, readResult: { data: null, error: { message: 'x' } } });
    expect(await dismissPendingSuggestion(c.supabase, 'row-1')).toEqual({ ok: false, reason: 'failed' });
  });

  it('a database error → failed', async () => {
    const c = client({ deleteResult: { data: null, error: { message: 'x' } } });
    expect(await dismissPendingSuggestion(c.supabase, 'row-1')).toEqual({ ok: false, reason: 'failed' });
  });
});
