/**
 * KAN-414 F4 (KAN-417 §8 group 3) — behavioural replacement for the
 * conversation-starter source scans over src/app/dashboard/profile/page.tsx.
 *
 * WHY: TWO GUARDS, ONE BLIND SPOT, AND AN UNTESTED BRANCH UNDERNEATH
 * ------------------------------------------------------------------
 * `tests/unit/affiliations-and-autosave.test.ts` and
 * `tests/unit/conversation-starters.test.ts` both grep this file for
 * `conversation_starter_prompts` and `profile_conversation_starters`. Neither
 * can see the code go away, because page.tsx:27 carries a doc comment naming
 * both strings:
 *
 *     * also matches `conversation_starter_prompts` / `profile_conversation_starters`
 *     * regression guard in `tests/unit/conversation-starters.test.ts`).
 *
 * VERIFIED (2026-08-02): delete lines 70-93 — both queries AND the join
 * flattening — and each regex still returns exactly one match, on that comment.
 * The comment was written to satisfy the scan, so the scan now guards the
 * comment. Both guards share the blind spot; this is CTL-039's shape, and it is
 * the case that motivated building CTL-039.
 *
 * Worse than a weak guard, there is nothing underneath it:
 * `grep -rn 'conversationAnswers|conversationPrompts' tests/` returned **zero**
 * hits across the whole tree before this file. In particular the array-vs-object
 * join flattening at lines 80-93 — which exists because Supabase's typegen
 * returns the joined row as an object *sometimes* and an array *other times* —
 * had no coverage at all, in a shape duplicated verbatim in `legacy/page.tsx`
 * and `[slug]/page.tsx`.
 *
 * THE INVARIANTS, IN WORDS
 * ------------------------
 *  1. Only ACTIVE prompts are offered, in `sort_order`, so a retired prompt
 *     cannot reappear in the editor.
 *  2. Answers are scoped to the signed-in member's own profile.
 *  3. Each answer's prompt text is resolved from the join in BOTH shapes
 *     Supabase returns — object and array. Getting this wrong renders a saved
 *     answer with a blank question above it.
 *  4. A missing or malformed join degrades to an empty string, not a crash on
 *     the profile editor.
 *
 * MUTATION PROOF (2026-08-02, each reverted)
 *   * delete lines 70-93 and pass empty arrays  -> cases 1-4 redden; BOTH old
 *     scans stay green, because page.tsx:27 still names the two tables
 *   * drop `.eq('is_active', true)`              -> case 1 reddens
 *   * handle only the object shape               -> case 3 reddens
 */
import React from 'react';
import type { ReactElement } from 'react';

// Source files use the automatic JSX runtime and do not import React
// themselves; swc's classic transform emits React.createElement, so React has
// to be resolvable as a global at call time. Same shim as
// tests/unit/compliance/legal-dynamic-disclosures.test.tsx.
(globalThis as unknown as { React: typeof React }).React = React;

type Row = Record<string, unknown>;
type Q = { table: string; op: string; args: unknown[] };

const queries: Q[] = [];
let tables: Record<string, Row[]> = {};

/** Chainable Supabase stub that records filters and resolves to fixture rows. */
function makeClient() {
  const chain = (table: string) => {
    const rows = () => tables[table] ?? [];
    const self: Record<string, unknown> = {};
    const rec = (op: string) => (...args: unknown[]) => {
      queries.push({ table, op, args });
      return self;
    };
    for (const op of ['select', 'eq', 'order', 'in', 'not']) self[op] = rec(op);
    self.single = async () => ({ data: rows()[0] ?? null, error: null });
    self.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
    // A terminated chain is awaited directly for list reads.
    self.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: rows(), error: null });
    return self;
  };
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: (t: string) => chain(t),
  };
}

jest.mock('@/lib/supabase-server', () => ({
  createClient: jest.fn(async () => makeClient()),
}));

// `redirect` mocked as a no-op does NOT throw the way Next's does, so the
// guard clauses would fall through on a missing fixture. Throwing keeps a
// misconfigured test RED rather than silently green — the fixtures below
// always supply a user and a profile.
jest.mock('next/navigation', () => ({
  redirect: jest.fn((to: string) => {
    throw new Error(`unexpected redirect to ${to}`);
  }),
}));

jest.mock('@/lib/convene/flags-user', () => ({
  isConveneEnabledForCurrentUser: jest.fn(async () => false),
}));

// The editor itself is out of scope — this asserts what the page HANDS it.
jest.mock('@/app/dashboard/profile/edit-profile-form', () => ({
  EditProfileForm: (props: Record<string, unknown>) => props,
}));

import ProfilePage from '@/app/dashboard/profile/page';

type Answer = { id: string; prompt_id: string; answer: string; prompt: string };

async function renderProps(): Promise<Record<string, unknown>> {
  const el = (await ProfilePage()) as ReactElement;
  return el.props as Record<string, unknown>;
}

const PROFILE = { id: 'profile-1', user_id: 'user-1' };

beforeEach(() => {
  queries.length = 0;
  tables = {
    profiles: [PROFILE],
    profile_items: [],
    school_affiliations: [],
    external_links: [],
    profile_manual_of_me: [],
    conversation_starter_prompts: [
      { id: 'p1', prompt: 'What are you reading?', sort_order: 1 },
    ],
    profile_conversation_starters: [],
  };
});

const argsFor = (table: string, op: string) =>
  queries.filter((q) => q.table === table && q.op === op).map((q) => q.args);

describe('profile editor page — conversation starters (behavioural, KAN-414 F4)', () => {
  it('offers only ACTIVE prompts, ordered by sort_order', async () => {
    const props = await renderProps();

    expect(argsFor('conversation_starter_prompts', 'eq')).toContainEqual([
      'is_active',
      true,
    ]);
    const [col, opts] = argsFor('conversation_starter_prompts', 'order')[0] as [
      string,
      { ascending: boolean },
    ];
    expect(col).toBe('sort_order');
    expect(opts).toEqual({ ascending: true });
    expect(props.conversationPrompts).toHaveLength(1);
  });

  it('scopes saved answers to the signed-in member’s own profile', async () => {
    await renderProps();

    // Without this filter the editor would load another member's answers.
    expect(argsFor('profile_conversation_starters', 'eq')).toContainEqual([
      'profile_id',
      'profile-1',
    ]);
  });

  it('resolves the joined prompt when Supabase returns it as an OBJECT', async () => {
    tables.profile_conversation_starters = [
      { id: 'a1', prompt_id: 'p1', answer: 'Middlemarch', prompt: { prompt: 'What are you reading?' } },
    ];

    const answers = (await renderProps()).conversationAnswers as Answer[];

    expect(answers).toEqual([
      { id: 'a1', prompt_id: 'p1', answer: 'Middlemarch', prompt: 'What are you reading?' },
    ]);
  });

  it('resolves the joined prompt when Supabase returns it as an ARRAY', async () => {
    // The same query returns either shape depending on typegen. Handling only
    // one renders a saved answer with a blank question above it — the reason
    // the branch exists, and it had no coverage anywhere before this test.
    tables.profile_conversation_starters = [
      { id: 'a1', prompt_id: 'p1', answer: 'Middlemarch', prompt: [{ prompt: 'What are you reading?' }] },
    ];

    const answers = (await renderProps()).conversationAnswers as Answer[];

    expect(answers[0].prompt).toBe('What are you reading?');
  });

  it('degrades a missing or malformed join to an empty string, not a crash', async () => {
    tables.profile_conversation_starters = [
      { id: 'a1', prompt_id: 'p1', answer: 'Middlemarch', prompt: null },
      { id: 'a2', prompt_id: 'p2', answer: 'Solaris', prompt: [] },
    ];

    const answers = (await renderProps()).conversationAnswers as Answer[];

    // The profile editor is the member's main surface; a null join must not
    // take it down.
    expect(answers.map((a) => a.prompt)).toEqual(['', '']);
    expect(answers.map((a) => a.answer)).toEqual(['Middlemarch', 'Solaris']);
  });
});
