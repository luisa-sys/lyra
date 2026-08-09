/**
 * KAN-414 F4 (KAN-417 §8 group 3) — behavioural replacement for the
 * server-action scans in tests/unit/conversation-starters.test.ts.
 *
 * WHAT THE SCANS ACTUALLY ASSERT
 * ------------------------------
 *   expect(src).toMatch(/sanitiseText/);
 *   expect(src).toMatch(/500/);
 *
 * `500` is satisfied by an HTTP status, a timeout, a stray constant — and by
 * the file's own doc comment at lines 18-19, which names both `sanitiseText`
 * and "≤500 chars". CTL-039 flags both as `comment-shadowed`: delete the code
 * and the prose keeps them green.
 *
 * THE SIBLING-DRIFT PROBLEM THE SCAN CANNOT SEE
 * ---------------------------------------------
 * `sanitiseText(...).slice(0, ANSWER_MAX)` appears TWICE — once in
 * `addConversationStarter` (l.65) and once in `updateConversationStarter`
 * (l.118). Remove it from ONE and the scan stays green, because the other
 * occurrence still satisfies the regex.
 *
 * That is the single most repeated defect shape in this codebase. CLAUDE.md
 * records eight tickets for a suspension guard added to one call site but not
 * its siblings, and BUGS-74 is the same story on the profile write path. A
 * whole-file substring match is structurally incapable of catching it.
 *
 * THE INVARIANTS, IN WORDS
 * ------------------------
 *  1. HTML is stripped before storage on BOTH paths. These answers render on
 *     the public profile.
 *  2. The 500-char cap applies on BOTH paths, mirroring the DB CHECK — an
 *     un-capped path fails at the database with a raw 22001 instead of a clean
 *     truncation.
 *  3. An empty or whitespace-only answer is refused, and nothing is written.
 *  4. An UPDATE is scoped to the caller's own profile. Without the second
 *     `.eq('profile_id', …)` any member could edit another's answer by id —
 *     an IDOR the scans do not look at at all.
 *  5. The DB trigger's cap message becomes friendly copy, and the match is
 *     generic over the digits so a future cap change needs no code edit.
 *
 * MUTATION PROOF (2026-08-02, each reverted). The old scan stayed 11/11 green
 * under EVERY one of these, including the last.
 *
 *   | mutation                                          | this suite |
 *   |---------------------------------------------------|------------|
 *   | drop `sanitiseText(...)` from the UPDATE path only | 2 failed   |
 *   | drop `.eq('profile_id', profileId)` from update    | 1 failed   |
 *   | drop `.slice(0, ANSWER_MAX)` from update only      | no change  |
 *   | raise `sanitiseText`'s default 500 -> 2000         | no change  |
 *   | remove BOTH cap layers                             | 2 failed   |
 *
 * THE 500 CAP IS DOUBLY ENFORCED, which is worth knowing and is not obvious
 * from either the code or the scan. `sanitiseText(input, maxLength = 500)`
 * slices internally, so the caller's `.slice(0, ANSWER_MAX)` is redundant
 * today — removing either alone changes nothing. That is defence in depth, not
 * dead code: the two must stay in agreement, because the DB CHECK is 500 and a
 * caller that opts into a longer `maxLength` for some other field would
 * otherwise let this path exceed it.
 *
 * So the cap cases here guard the EFFECTIVE cap, whichever layer supplies it —
 * and they do bite, as the last row shows. What no substring match can do is
 * notice the cap disappearing entirely: `/500/` is satisfied by the doc comment
 * alone, so the scan is green even with both layers gone.
 */
type Call = { table: string; op: string; args: unknown[] };

const calls: Call[] = [];
let dbError: { message: string; code?: string } | null = null;

function makeClient() {
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    const rec = (op: string) => (...args: unknown[]) => {
      calls.push({ table, op, args });
      return self;
    };
    for (const op of ['select', 'eq', 'insert', 'update', 'delete']) self[op] = rec(op);
    self.single = async () => ({ data: { id: 'profile-1' }, error: null });
    self.then = (resolve: (v: unknown) => unknown) => resolve({ error: dbError });
    return self;
  };
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: (t: string) => chain(t),
  };
}

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/modules/platform/supabase-server', () => ({
  createClient: jest.fn(async () => makeClient()),
}));
jest.mock('@/modules/guards/profile-rate-limit', () => ({
  checkProfileWriteRateLimit: jest.fn(async () => ({ allowed: true })),
}));
// Moderation is a separate concern with its own tests; allow everything so the
// sanitising and capping are what these cases actually exercise.
jest.mock('@/lib/moderation-audit', () => ({
  moderateAndAudit: jest.fn(async () => ({ ok: true })),
}));

import {
  addConversationStarter,
  updateConversationStarter,
} from '@/app/dashboard/profile/conversation-starters-actions';

const PROMPT_ID = '11111111-2222-3333-4444-555555555555';

/** The payload actually handed to the DB, per operation. */
function payload(op: 'insert' | 'update'): Record<string, unknown> {
  const c = calls.find((x) => x.op === op);
  return (c?.args[0] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  calls.length = 0;
  dbError = null;
});

describe('conversation-starter actions — sanitising and capping on BOTH paths', () => {
  it('strips HTML on ADD', async () => {
    const res = await addConversationStarter({
      promptId: PROMPT_ID,
      answer: 'I like <b>books</b><script>alert(1)</script>',
    });

    expect(res.success).toBe(true);
    // These answers render on the public profile.
    expect(String(payload('insert').answer)).not.toContain('<script');
    expect(String(payload('insert').answer)).not.toContain('<b>');
  });

  it('strips HTML on UPDATE — the sibling the scan cannot distinguish', async () => {
    const res = await updateConversationStarter('answer-1', 'Also <i>poems</i>');

    expect(res.success).toBe(true);
    expect(String(payload('update').answer)).not.toContain('<i>');
  });

  it('caps at 500 characters on ADD', async () => {
    await addConversationStarter({ promptId: PROMPT_ID, answer: 'a'.repeat(600) });

    // Mirrors the DB CHECK; an un-capped path fails with a raw 22001 instead.
    expect(String(payload('insert').answer)).toHaveLength(500);
  });

  it('caps at 500 characters on UPDATE', async () => {
    await updateConversationStarter('answer-1', 'b'.repeat(600));

    expect(String(payload('update').answer)).toHaveLength(500);
  });

  it('refuses an empty or whitespace-only answer, writing nothing', async () => {
    const blank = await addConversationStarter({ promptId: PROMPT_ID, answer: '   ' });
    const stripped = await updateConversationStarter('answer-1', '<b></b>');

    expect(blank.success).toBe(false);
    expect(stripped.success).toBe(false);
    expect(calls.some((c) => c.op === 'insert' || c.op === 'update')).toBe(false);
  });
});

describe('conversation-starter actions — ownership and error mapping', () => {
  it('scopes an UPDATE to the caller’s own profile (IDOR guard)', async () => {
    await updateConversationStarter('answer-belonging-to-someone-else', 'mine now');

    const eqs = calls
      .filter((c) => c.table === 'profile_conversation_starters' && c.op === 'eq')
      .map((c) => c.args as [string, unknown]);

    // Filtering by id ALONE would let any member edit any answer they can name.
    expect(eqs).toContainEqual(['profile_id', 'profile-1']);
    expect(eqs).toContainEqual(['id', 'answer-belonging-to-someone-else']);
  });

  it('rejects a non-UUID prompt id before touching the database', async () => {
    const res = await addConversationStarter({ promptId: 'not-a-uuid', answer: 'hi' });

    expect(res.success).toBe(false);
    expect(calls.some((c) => c.op === 'insert')).toBe(false);
  });

  it('turns the DB cap trigger into friendly copy, for any digit count', async () => {
    // The trigger message carries the live cap. Matching it generically is why
    // raising the cap needs no code edit — so both forms must map.
    for (const n of [5, 10, 25]) {
      calls.length = 0;
      dbError = { message: `Conversation-starter answer limit (${n}) reached` };
      const res = await addConversationStarter({ promptId: PROMPT_ID, answer: 'hi' });

      expect(res.success).toBe(false);
      if (!res.success) expect(res.error).toContain('up to 10 prompts');
    }
  });

  it('turns a duplicate-answer collision into an edit-instead hint', async () => {
    dbError = { message: 'duplicate key value', code: '23505' };

    const res = await addConversationStarter({ promptId: PROMPT_ID, answer: 'hi' });

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/already answered/i);
  });
});
