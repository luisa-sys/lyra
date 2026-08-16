/**
 * KAN-445 — "A bit more about me": the founder's ten prompts, three questions
 * a member writes themselves, and the migration-ordering hazard that comes
 * with the new `custom_prompt` column.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Three separate defect shapes converge on this change, and each one has
 * already shipped to production in this repo at least once.
 *
 * 1. PGRST204 — THE KEY IS THE PAYLOAD, NOT THE VALUE.
 *    PostgREST builds the INSERT/UPDATE column list from the payload KEYS, so
 *    sending `custom_prompt: null` against a database that has not run
 *    20260803160000 yet fails the WHOLE request — the null value does not
 *    save you. Code reaches an environment before its migration does, so this
 *    is the normal case, not the edge case. `npm run type-check` is blind to
 *    it: `src/modules/platform/supabase-server.ts` builds an UNTYPED client, so no column
 *    name in any payload is ever checked against a schema. The only thing that
 *    can catch it is a test that looks at the payload actually handed to the
 *    driver, which is what the first describe below does.
 *
 * 2. BUGS-74 — `undefined` AND `null` ARE DIFFERENT INSTRUCTIONS.
 *    "The caller did not edit the question" must leave the column alone;
 *    "the caller cleared it" would write NULL. Collapsing the two with
 *    `?? null` is what wiped real members' `good_to_know` and `boundaries` on
 *    all four environments. Here it would blank a member's own question every
 *    time they edited only the answer — and because `custom_prompt` is half of
 *    an XOR check, the write would then fail outright.
 *
 * 3. THE SIBLING-DRIFT SHAPE.
 *    `addConversationStarter` and `updateConversationStarter` both clean the
 *    member-written question. Any whole-file substring scan is satisfied by
 *    either one, so the cases below exercise BOTH paths separately — the same
 *    reason tests/unit/conversation-starters-actions-behaviour.test.ts exists.
 *
 * WHAT IS DELIBERATELY *NOT* ASSERTED
 * -----------------------------------
 * The total answer cap. `enforce_pcs_cap()` is out of scope for KAN-445 and is
 * left untouched in every environment; the migration case below asserts that
 * the migration does not redefine it, which is the only claim this change is
 * entitled to make about it.
 *
 * MUTATION PROOF — see the session report. Every case here was verified to go
 * RED against a deliberate break of the real subject, and the subject restored
 * byte-identically afterwards (shasum-checked).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SRC } from '../support/source-paths';

// ---------------------------------------------------------------------------
// Supabase stub — per-STATEMENT, not pooled.
//
// A pooled `calls.find(op === 'eq')` cannot tell the ownership pre-read on
// `profiles` from the filter on the UPDATE, which is exactly how an assertion
// meant for a write ends up satisfied by an earlier SELECT. Every recorded
// call therefore carries its table and its position, and every assertion
// below names both.
// ---------------------------------------------------------------------------
type Call = { seq: number; table: string; op: string; args: unknown[] };

const calls: Call[] = [];
let dbError: { message: string; code?: string } | null = null;
let seq = 0;

function makeClient() {
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    const rec = (op: string) => (...args: unknown[]) => {
      calls.push({ seq: seq++, table, op, args });
      return self;
    };
    for (const op of ['select', 'eq', 'insert', 'update', 'delete']) self[op] = rec(op);
    self.single = async () => ({ data: { id: 'profile-1' }, error: null });
    self.then = (resolveFn: (v: unknown) => unknown) => resolveFn({ error: dbError });
    return self;
  };
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: (t: string) => chain(t),
  };
}

const mockModerate = jest.fn(async () => ({ ok: true }) as { ok: boolean; error?: string });

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/modules/platform/supabase-server', () => ({
  createClient: jest.fn(async () => makeClient()),
}));
jest.mock('@/modules/guards/profile-rate-limit', () => ({
  checkProfileWriteRateLimit: jest.fn(async () => ({ allowed: true })),
}));
jest.mock('@/modules/audit/moderation-audit', () => ({
  moderateAndAudit: (...args: unknown[]) => mockModerate(...(args as [])),
}));

import {
  addConversationStarter,
  updateConversationStarter,
} from '@/app/dashboard/profile/conversation-starters-actions';

const PROMPT_ID = '11111111-2222-3333-4444-555555555555';
const STARTERS = 'profile_conversation_starters';

/** The payload of the single write statement issued against the starters table. */
function writePayload(op: 'insert' | 'update'): Record<string, unknown> {
  const matching = calls.filter((c) => c.table === STARTERS && c.op === op);
  // More than one would make "the payload" ambiguous and quietly hide a second
  // write; zero means the action never reached the database.
  expect(matching).toHaveLength(1);
  return (matching[0].args[0] ?? {}) as Record<string, unknown>;
}

function wrote(): boolean {
  return calls.some((c) => c.table === STARTERS && (c.op === 'insert' || c.op === 'update'));
}

beforeEach(() => {
  calls.length = 0;
  seq = 0;
  dbError = null;
  mockModerate.mockClear();
  mockModerate.mockImplementation(async () => ({ ok: true }));
});

// ===========================================================================
describe('KAN-445 payload-key safety — a key only when there is a value', () => {
  it('OMITS custom_prompt entirely when answering a seeded prompt', async () => {
    const res = await addConversationStarter({ promptId: PROMPT_ID, answer: 'Middlemarch' });

    expect(res.success).toBe(true);
    const payload = writePayload('insert');
    // `'custom_prompt' in payload`, NOT `payload.custom_prompt === undefined`:
    // the second passes for `{ custom_prompt: undefined }`, which is exactly
    // the shape PostgREST turns into a PGRST204 on a pre-migration database.
    expect(Object.prototype.hasOwnProperty.call(payload, 'custom_prompt')).toBe(false);
    expect(payload.prompt_id).toBe(PROMPT_ID);
  });

  it('OMITS custom_prompt when an update touches only the answer', async () => {
    const res = await updateConversationStarter('answer-1', 'A better answer');

    expect(res.success).toBe(true);
    const payload = writePayload('update');
    expect(Object.prototype.hasOwnProperty.call(payload, 'custom_prompt')).toBe(false);
    // …and the answer still goes, so the omission is not the action bailing out.
    expect(payload.answer).toBe('A better answer');
  });

  it('OMITS prompt_id when the member wrote the question themselves', async () => {
    const res = await addConversationStarter({
      customPrompt: 'What is in my kitchen?',
      answer: 'A very old kettle.',
    });

    expect(res.success).toBe(true);
    const payload = writePayload('insert');
    // A null prompt_id is what the XOR check wants, and omitting the key is
    // how the column default supplies it without naming it.
    expect(Object.prototype.hasOwnProperty.call(payload, 'prompt_id')).toBe(false);
    expect(payload.custom_prompt).toBe('What is in my kitchen?');
  });

  it('sends custom_prompt on an update ONLY when the question was edited', async () => {
    await updateConversationStarter('answer-1', 'Still an old kettle.', 'What is in my kitchen?');

    const payload = writePayload('update');
    expect(payload.custom_prompt).toBe('What is in my kitchen?');
    expect(payload.answer).toBe('Still an old kettle.');
  });
});

// ===========================================================================
describe('KAN-445 XOR — a seeded prompt or your own, never both, never neither', () => {
  it('refuses both at once, writing nothing', async () => {
    const res = await addConversationStarter({
      promptId: PROMPT_ID,
      customPrompt: 'Mine too',
      answer: 'hi',
    });

    expect(res.success).toBe(false);
    // The DB constraint would catch this as a 23514; refusing here is what
    // turns it into a sentence a member can act on.
    expect(wrote()).toBe(false);
  });

  it('refuses neither, writing nothing', async () => {
    const res = await addConversationStarter({ answer: 'an answer to nothing' });

    expect(res.success).toBe(false);
    expect(wrote()).toBe(false);
  });

  it('still refuses a malformed prompt id before touching the database', async () => {
    const res = await addConversationStarter({ promptId: 'not-a-uuid', answer: 'hi' });

    expect(res.success).toBe(false);
    expect(wrote()).toBe(false);
  });
});

// ===========================================================================
describe('KAN-445 the member-written question is public text — BOTH paths', () => {
  it('strips HTML from the question on ADD', async () => {
    await addConversationStarter({
      customPrompt: 'What is <b>in</b> my kitchen?<script>alert(1)</script>',
      answer: 'A kettle.',
    });

    const question = String(writePayload('insert').custom_prompt);
    // This renders on the public profile, above the answer.
    expect(question).not.toContain('<script');
    expect(question).not.toContain('<b>');
  });

  it('strips HTML from the question on UPDATE — the sibling a scan cannot separate', async () => {
    await updateConversationStarter('a1', 'A kettle.', 'What is <i>really</i> in my kitchen?');

    expect(String(writePayload('update').custom_prompt)).not.toContain('<i>');
  });

  it('caps the question at 140 characters on ADD', async () => {
    await addConversationStarter({ customPrompt: 'q'.repeat(400), answer: 'A kettle.' });

    // Mirrors `pcs_custom_prompt_length`; an uncapped path fails with a raw
    // 23514 instead of a clean truncation.
    expect(String(writePayload('insert').custom_prompt)).toHaveLength(140);
  });

  it('caps the question at 140 characters on UPDATE', async () => {
    await updateConversationStarter('a1', 'A kettle.', 'q'.repeat(400));

    expect(String(writePayload('update').custom_prompt)).toHaveLength(140);
  });

  it('refuses a question that is empty once stripped, writing nothing', async () => {
    const blank = await addConversationStarter({ customPrompt: '   ', answer: 'A kettle.' });
    const stripped = await updateConversationStarter('a1', 'A kettle.', '<b></b>');

    // '   ' fails the XOR check (nothing supplied); '<b></b>' survives to the
    // cleaner and is rejected there. Both must end with nothing written.
    expect(blank.success).toBe(false);
    expect(stripped.success).toBe(false);
    expect(wrote()).toBe(false);
  });

  it('sends the question through moderation, not just the answer', async () => {
    await addConversationStarter({ customPrompt: 'What is in my kitchen?', answer: 'A kettle.' });

    expect(mockModerate).toHaveBeenCalledTimes(1);
    const submitted = String(
      (mockModerate.mock.calls[0] as unknown[])[1] &&
        ((mockModerate.mock.calls[0] as unknown[])[1] as { text: string }).text,
    );
    // Moderating only the answer would leave the question an unmoderated
    // public field that any member can fill with anything.
    expect(submitted).toContain('What is in my kitchen?');
    expect(submitted).toContain('A kettle.');
  });

  // The UPDATE twin of the test above. Without it, the edit path could
  // moderate only the answer and nothing would notice — so a member could
  // save an innocuous question, pass moderation, then EDIT it to anything at
  // all, and that text renders as a public heading on their profile. The
  // question is the half that most needs moderating, and edit is the path
  // that gets used after the first save.
  it('sends an EDITED question through moderation too, not just the answer', async () => {
    await updateConversationStarter('answer-1', 'Still an old kettle.', 'What is in my kitchen now?');

    expect(mockModerate).toHaveBeenCalledTimes(1);
    const submitted = String(
      (mockModerate.mock.calls[0] as unknown[])[1] &&
        ((mockModerate.mock.calls[0] as unknown[])[1] as { text: string }).text,
    );
    expect(submitted).toContain('What is in my kitchen now?');
    expect(submitted).toContain('Still an old kettle.');
  });

  it('does not write when moderation rejects a member-written question', async () => {
    mockModerate.mockImplementation(async () => ({ ok: false, error: 'Blocked' }));

    const res = await addConversationStarter({ customPrompt: 'something vile', answer: 'x' });

    expect(res.success).toBe(false);
    expect(wrote()).toBe(false);
  });
});

// ===========================================================================
describe('KAN-445 cap errors — the custom cap must be read BEFORE the general one', () => {
  it('maps the custom-question cap to its own copy', async () => {
    dbError = { message: 'Custom question limit (3) reached' };

    const res = await addConversationStarter({ customPrompt: 'A fourth?', answer: 'x' });

    expect(res.success).toBe(false);
    // 'Custom question limit (3) reached' ALSO matches the general
    // /limit \(\d+\) reached/ pattern. Test the general one first and a member
    // who filled their three own questions is told to delete one of their ten
    // answers — advice that does not fix anything.
    if (!res.success) {
      expect(res.error).toMatch(/up to 3 of your own questions/i);
      expect(res.error).not.toMatch(/up to 10 prompts/i);
    }
  });

  it('still maps the general answer cap to the general copy', async () => {
    for (const n of [5, 10, 25]) {
      calls.length = 0;
      dbError = { message: `Conversation-starter answer limit (${n}) reached` };

      const res = await addConversationStarter({ promptId: PROMPT_ID, answer: 'x' });

      expect(res.success).toBe(false);
      if (!res.success) expect(res.error).toContain('up to 10 prompts');
    }
  });

  it('maps the custom cap on the UPDATE path too', async () => {
    dbError = { message: 'Custom question limit (3) reached' };

    const res = await updateConversationStarter('a1', 'x', 'A fourth?');

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/up to 3 of your own questions/i);
  });
});

// ===========================================================================
// The migration is data + DDL; there is no runtime here to exercise, so this
// is a source scan — but a comment-stripped one. The migration's own header
// quotes the eight prompts it retires and names `enforce_pcs_cap()`, so an
// unstripped scan would match the prose that documents the change rather than
// the change (SEC-100 / CTL-039's shape, and the reason `is_published` stayed
// green while suspended members were being indexed).
// ===========================================================================
describe('KAN-445 migration — the offered set, and what it must not touch', () => {
  const ROOT = resolve(__dirname, '../..');
  const raw = readFileSync(resolve(ROOT, SRC.migrations20260803160000Kan445CustomConversationPrompts), 'utf-8');
  /** SQL with every `--` comment removed, so only executable text is matched. */
  const sql = raw
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

  // Hard-coded from the founder's own document ("Lyra-Profile-Mockups-
  // Questions-and-Answers.docx" → "The set questions people can answer"),
  // NOT read out of the migration. A list pinned by mapping over the thing
  // under test cannot fail.
  const FOUNDER_PROMPTS = [
    'If you could invite anyone, living or dead, to a dinner party — who would you have?',
    "What are you most proud of that wouldn't make it onto your CV?",
    'If you could have any job — real or not — what would it be?',
    "Skills I'm trying to learn",
    "Something I've changed my mind about recently",
    'What qualities do you most appreciate in your closest friends?',
    "The best advice I've ever received",
    'If you could master any skill instantly, what would it be?',
    "What's a small, daily act of kindness that usually goes unappreciated?",
    "What's your best childhood memory?",
  ];

  /**
   * The statement between two markers.
   *
   * Each canonical prompt is named in THREE separate statements — the seed,
   * the activate/re-order, and the retire-everything-else exclusion list — and
   * a whole-file `toContain` is satisfied by any one of them. Mutation-proved
   * on 2026-08-03: dropping a prompt from the seed VALUES list alone left the
   * whole-file version of this case green, because the other two statements
   * still named it. Same family as the sibling-drift shape the actions suite
   * guards against, and the reason each block is now asserted separately.
   */
  function block(start: string, end: string): string {
    const i = sql.indexOf(start);
    expect(i).toBeGreaterThan(-1);
    const j = sql.indexOf(end, i + start.length);
    expect(j).toBeGreaterThan(i);
    return sql.slice(i, j);
  }

  const seedBlock = block(
    'insert into public.conversation_starter_prompts',
    'on conflict (prompt) do nothing',
  );
  const orderBlock = block(
    'update public.conversation_starter_prompts p',
    'where p.prompt = v.prompt',
  );
  const retireBlock = block('set is_active = false', ');');

  it.each(FOUNDER_PROMPTS)('offers the founder prompt: %s', (prompt) => {
    // Postgres escapes a literal apostrophe by doubling it.
    const literal = prompt.replace(/'/g, "''");
    // Seeded, so a fresh database has it…
    expect(seedBlock).toContain(literal);
    // …activated and ordered, so an environment that already had it retired
    // (or in the 2026-05 order) is corrected…
    expect(orderBlock).toContain(literal);
    // …and excluded from the retirement sweep, so step 4 does not immediately
    // switch off what steps 2 and 3 just turned on.
    expect(retireBlock).toContain(literal);
  });

  it('retires exactly the prompts that are not the founder ten', () => {
    // Counting is what catches an ELEVENTH prompt smuggled into the exclusion
    // list, which would silently keep a retired prompt on offer.
    const quoted = retireBlock.match(/'(?:[^']|'')*'/g) ?? [];
    expect(quoted).toHaveLength(FOUNDER_PROMPTS.length);
  });

  it('activates the ten and retires the rest without deleting a single row', () => {
    expect(sql).toMatch(/set\s+is_active\s*=\s*false/i);
    // A prompt row is the FK target of every answer that chose it. Deleting
    // one either fails or orphans a member's saved answer.
    expect(sql).not.toMatch(/delete\s+from\s+public\.conversation_starter_prompts/i);
  });

  it('makes the seed genuinely idempotent', () => {
    // `on conflict do nothing` needs something to conflict ON; the table had
    // no unique key on `prompt`, so without this index a re-run duplicates
    // every row instead of skipping it.
    expect(sql).toMatch(/create unique index if not exists[\s\S]*conversation_starter_prompts \(prompt\)/i);
    expect(sql).toMatch(/on conflict \(prompt\) do nothing/i);
  });

  it('permits a custom question: nullable prompt_id, a column, and an XOR', () => {
    expect(sql).toMatch(/alter column prompt_id drop not null/i);
    expect(sql).toMatch(/add column if not exists custom_prompt text/i);
    // (a is null) <> (b is null) is true for exactly one of them being set.
    expect(sql).toMatch(/\(prompt_id is null\) <> \(custom_prompt is null\)/i);
  });

  it('caps member-written questions at three, on INSERT *and* UPDATE', () => {
    expect(sql).toMatch(/Custom question limit \(3\) reached/);
    // INSERT-only would let a member add three custom rows, then flip seeded
    // rows to custom and sail past the cap.
    expect(sql).toMatch(/before insert or update on public\.profile_conversation_starters/i);
  });

  it('renames the section heading everywhere a member can see it', () => {
    // Not the migration — the two surfaces. Kept here because the rename and
    // the prompt set are one decision and should fail together.
    const strip = (text: string) =>
      text
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '') // JSX comments
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

    const publicPage = strip(readFileSync(resolve(ROOT, SRC.slugPage), 'utf-8'));
    const editor = strip(readFileSync(resolve(ROOT, SRC.editProfileForm), 'utf-8'));

    // CTL-039 had the OLD heading baselined as comment-shadowed on the public
    // page: the JSX comment above the heading repeated it word for word, so
    // deleting the heading left the guard green. Stripping comments first is
    // what makes this assertion about what a member reads.
    expect(publicPage).toContain('A bit more about me');
    expect(publicPage).not.toContain('A few more things about me');
    expect(editor).toContain('A bit more about me');
  });

  it('does NOT redefine enforce_pcs_cap — the total cap is out of scope', () => {
    // Raising the production answer cap is an open founder decision. Rewriting
    // this function here would bake one number into every environment the
    // migration reaches, which is precisely the change that is not ours.
    // The header comment discusses it at length; comment-stripping is what
    // makes this assertion about the SQL rather than about the prose.
    expect(sql).not.toMatch(/create or replace function public\.enforce_pcs_cap/i);
  });
});

// ───────────── The read sites and the member-facing surface ─────────────

// Review found the 42703 read-side defence pinned on only ONE of the three
// read sites, and the two user-visible halves of the feature completely
// unguarded. Each of these four mutations previously left the FULL suite
// green: naming custom_prompt in an explicit column list on the public page
// or the legacy editor (a 42703 on a pre-migration environment, which the
// public page's error handler turns into a hard 500 on EVERY published
// profile); dropping `customPrompt ??` so the public profile ignores the
// member's own question entirely; and deleting the whole write-your-own UI
// block — KAN-445's headline deliverable — which even left type-check green.
// Comments are stripped so none of these can be satisfied by prose.
describe('KAN-445: every read site and the write-your-own surface', () => {
  const root = resolve(__dirname, '../..');
  const noComments = (text: string) =>
    text
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const src = (rel: string) => noComments(readFileSync(resolve(root, rel), 'utf-8'));
  const publicPage = src(SRC.slugPage);
  const legacyPage = src(SRC.legacyPage);
  const step = src(SRC.conversationStartersStep);

  // select('*') tolerates a missing column; naming it does not.
  it('the public profile reads starters with select(*), never a column list naming custom_prompt', () => {
    expect(publicPage).toContain("select('*, prompt:conversation_starter_prompts");
    expect(publicPage).not.toMatch(/select\('[^']*custom_prompt/);
  });

  it('the legacy editor reads starters with select(*) too', () => {
    expect(legacyPage).toContain("select('*, prompt:conversation_starter_prompts");
    expect(legacyPage).not.toMatch(/select\('[^']*custom_prompt/);
  });

  it('the public profile prefers the member-written question over the seeded one', () => {
    expect(publicPage).toMatch(/customPrompt\s*\?\?\s*joined\?\.prompt/);
  });

  it('the write-your-own UI exists in the editor', () => {
    expect(step).toContain('Write your own question');
    expect(step).toContain('ownOpen');
  });
});

