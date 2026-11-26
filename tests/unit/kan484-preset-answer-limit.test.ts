/**
 * KAN-484 — each preset question carries its own answer limit (spec v0.8 §09),
 * and the server applies it on both the add and the update path.
 *
 * The DB trigger enforce_pcs_answer_max() is the real gate; these cases pin
 * the app-level behaviour a member actually sees: the answer is capped at the
 * preset's limit (not a blanket 500), an unavailable question is refused
 * before any write, and a member-written question uses 500.
 */

type Call = { table: string; op: string; args: unknown[] };
const calls: Call[] = [];
let promptRow: { answer_max: number | null } | null = { answer_max: 200 };

function makeClient() {
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    const rec = (op: string) => (...args: unknown[]) => {
      calls.push({ table, op, args });
      return self;
    };
    for (const op of ['select', 'eq', 'insert', 'update', 'delete']) self[op] = rec(op);
    self.single = async () => {
      if (table === 'conversation_starter_prompts') {
        return promptRow ? { data: promptRow, error: null } : { data: null, error: { message: 'not found' } };
      }
      return { data: { id: 'profile-1' }, error: null };
    };
    self.then = (resolve: (v: unknown) => unknown) => resolve({ error: null });
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
jest.mock('@/modules/audit/moderation-audit', () => ({
  moderateAndAudit: jest.fn(async () => ({ ok: true })),
}));

import {
  addConversationStarter,
  updateConversationStarter,
} from '@/app/dashboard/profile/conversation-starters-actions';

const PROMPT_ID = '11111111-2222-3333-4444-555555555555';

function writePayload(op: 'insert' | 'update'): Record<string, unknown> {
  const c = calls.find((x) => x.table === 'profile_conversation_starters' && x.op === op);
  return (c?.args[0] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  calls.length = 0;
  promptRow = { answer_max: 200 };
});

describe('KAN-484 per-question answer limits', () => {
  // KAN-486 (spec v0.8 §3, founder-approved 2026-11-23): over-limit answers
  // are REJECTED, not cut. The three "caps" cases below used to assert the
  // stored answer was truncated to the limit (200 / 500 / 200).
  it('rejects a preset answer over THAT preset’s limit on ADD (200, not 500)', async () => {
    const res = await addConversationStarter({ promptId: PROMPT_ID, answer: 'a'.repeat(201) });
    expect(res).toEqual({
      success: false,
      error: 'Your answer is too long: 201 characters (limit 200, including spaces).',
    });
    expect(calls.some((c) => c.table === 'profile_conversation_starters' && c.op === 'insert')).toBe(false);
  });

  it('accepts a preset answer at exactly its limit on ADD', async () => {
    const res = await addConversationStarter({ promptId: PROMPT_ID, answer: 'a'.repeat(200) });
    expect(res.success).toBe(true);
    expect(writePayload('insert').answer).toBe('a'.repeat(200));
  });

  it('allows a long answer when the preset’s limit is higher (perfect day = 1000)', async () => {
    promptRow = { answer_max: 1000 };
    await addConversationStarter({ promptId: PROMPT_ID, answer: 'b'.repeat(900) });
    expect(String(writePayload('insert').answer)).toHaveLength(900);
  });

  it('refuses an unavailable question before writing anything', async () => {
    promptRow = null;
    const res = await addConversationStarter({ promptId: PROMPT_ID, answer: 'hello' });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/no longer available/i);
    expect(calls.some((c) => c.table === 'profile_conversation_starters' && c.op === 'insert')).toBe(false);
  });

  it('limits a member-written question’s answer to 500 without reading the presets', async () => {
    const over = await addConversationStarter({ customPrompt: 'My own?', answer: 'c'.repeat(501) });
    expect(over).toEqual({
      success: false,
      error: 'Your answer is too long: 501 characters (limit 500, including spaces).',
    });
    await addConversationStarter({ customPrompt: 'My own?', answer: 'c'.repeat(500) });
    expect(writePayload('insert').answer).toBe('c'.repeat(500));
    expect(calls.some((c) => c.table === 'conversation_starter_prompts')).toBe(false);
  });

  it('applies the preset’s limit on UPDATE when the preset is named', async () => {
    const res = await updateConversationStarter('answer-1', 'd'.repeat(201), undefined, PROMPT_ID);
    expect(res).toEqual({
      success: false,
      error: 'Your answer is too long: 201 characters (limit 200, including spaces).',
    });
    expect(calls.some((c) => c.table === 'profile_conversation_starters' && c.op === 'update')).toBe(false);
  });

  it('keeps the UPDATE scoped to the caller’s own profile', async () => {
    await updateConversationStarter('answer-1', 'mine', undefined, PROMPT_ID);
    const eqs = calls
      .filter((c) => c.table === 'profile_conversation_starters' && c.op === 'eq')
      .map((c) => c.args);
    expect(eqs).toContainEqual(['profile_id', 'profile-1']);
    // The limit lookup must not add a second profile_conversation_starters
    // read whose filters could mask a missing ownership filter on the UPDATE.
    expect(calls.filter((c) => c.table === 'profile_conversation_starters' && c.op === 'select')).toEqual([]);
  });
});
