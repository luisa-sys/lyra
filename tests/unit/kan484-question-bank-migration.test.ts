/**
 * KAN-484 — the v0.8 §09 question-bank migration
 * (supabase/migrations/20261122120000_kan484_question_bank.sql).
 *
 * Static checks on the migration file, because migrations are applied via the
 * Supabase MCP after review rather than executed by CI (same approach as the
 * SEC-45 / SEC-196 suites). SQL comments are stripped before every match, so
 * the prose explaining a rule can never satisfy the assertion for it
 * (CLAUDE.md "Writing a test that can actually fail", failure mode 2).
 *
 * The 16 questions and limits below are written out as LITERALS copied from
 * the spec, never derived from the migration (failure mode 10: an oracle taken
 * from the subject can never disagree with it).
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS = join(__dirname, '..', '..', 'supabase', 'migrations');

function stripSqlComments(sql: string): string {
  return sql.replace(/--.*$/gm, '');
}

function migration(): string {
  const file = readdirSync(MIGRATIONS).find((f) => /_kan484_question_bank\.sql$/.test(f));
  if (!file) throw new Error('KAN-484 migration not found');
  return stripSqlComments(readFileSync(join(MIGRATIONS, file), 'utf8'));
}

// Spec v0.8 §09 table, verbatim (curly apostrophes as in the spec).
const V08_PRESETS: ReadonlyArray<[string, number]> = [
  ['Who you’d invite for a dinner party, dead or alive?', 350],
  ['What do you think of when you hear the word ‘successful’?', 500],
  ['What’s a question you wish people asked you more often?', 350],
  ['If you could become an expert in anything overnight, what would you choose?', 350],
  ['If you could have a different career and money was irrelevant, what would it be?', 500],
  ['What are the places you want to go?', 350],
  ['If you could witness any moment in history, which would it be?', 500],
  ['What don’t you leave the house with?', 200],
  ['What’s the most niche topic you could talk about for 10 minutes with no preparation?', 350],
  ['Which ordinary task do you take far too seriously?', 350],
  ['Which fictional character would you trust to house-sit for a week?', 350],
  ['Who helped shape who you are today?', 500],
  ['Which song can change your mood instantly?', 250],
  ['Describe your perfect day, start to finish.', 1000],
  ['What tradition, from your family or your own, do you love?', 500],
  ['What failure set you up for something better later?', 750],
];

describe('KAN-484 question bank migration', () => {
  const sql = migration();

  it('the corpus is the 16 v0.8 presets', () => {
    expect(V08_PRESETS).toHaveLength(16);
  });

  it.each(V08_PRESETS.map(([q, max], i) => [i + 1, q, max] as const))(
    'seeds preset %i with its exact wording and answer limit',
    (_n, question, max) => {
      const escaped = question.replace(/'/g, "''").replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(sql).toMatch(new RegExp(`\\('${escaped}',\\s*\\d+,\\s*${max},\\s*true\\)`));
    },
  );

  it('deactivates every other prompt instead of deleting it', () => {
    expect(sql).toMatch(/update public\.conversation_starter_prompts\s+set is_active = false/i);
    expect(sql).not.toMatch(/delete\s+from\s+public\.conversation_starter_prompts/i);
    expect(sql).not.toMatch(/truncate/i);
  });

  it('adds a per-question answer limit bounded 50..2000', () => {
    expect(sql).toMatch(/add column if not exists answer_max integer not null default 500/i);
    expect(sql).toMatch(/check \(answer_max between 50 and 2000\)/i);
  });

  it('enforces the per-question limit server-side on insert AND update', () => {
    expect(sql).toMatch(/create trigger pcs_answer_max before insert or update on public\.profile_conversation_starters/i);
    expect(sql).toMatch(/v_max := 500;/);
  });

  it('removes the total-answer cap (v0.8: active presets + 10 custom is not a ceiling)', () => {
    expect(sql).toMatch(/drop trigger if exists pcs_cap on public\.profile_conversation_starters/i);
    expect(sql).toMatch(/drop function if exists public\.enforce_pcs_cap\(\)/i);
  });

  it('raises the custom-question cap to 10 and the custom question length to 180', () => {
    expect(sql).toMatch(/\) >= 10 then\s+raise exception 'Custom question limit \(10\) reached'/);
    expect(sql).toMatch(/length\(custom_prompt\) <= 180/);
  });

  it('revokes EXECUTE on its trigger functions from public, anon and authenticated (gotcha #26)', () => {
    for (const fn of ['enforce_pcs_answer_max', 'enforce_pcs_custom_cap']) {
      expect(sql).toMatch(new RegExp(`revoke execute on function public\\.${fn}\\(\\) from public, anon, authenticated`));
    }
  });
});
