/**
 * KAN-496 — wording fix for the "leave the house" preset
 * (supabase/migrations/20261126180000_kan496_question_wording.sql).
 *
 * Static checks, as for the KAN-484 suite: migrations are applied via the
 * Supabase MCP after review, not by CI. SQL comments are stripped first so the
 * prose can never satisfy an assertion. Expected wording is written out as
 * literals from the founder's feedback (2026-11-26), not read from the file.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS = join(__dirname, '..', '..', 'supabase', 'migrations');
const OLD = 'What don’t you leave the house with?';
const NEW = 'What don’t you leave the house without?';

function sql(): string {
  const file = readdirSync(MIGRATIONS).find((f) => /_kan496_question_wording\.sql$/.test(f));
  if (!file) throw new Error('KAN-496 migration not found');
  return readFileSync(join(MIGRATIONS, file), 'utf8').replace(/--.*$/gm, '');
}

describe('KAN-496: "leave the house without" wording fix', () => {
  const body = sql();

  test('updates the old wording to the new wording in place (same permanent ID)', () => {
    expect(body).toMatch(/update\s+public\.conversation_starter_prompts/i);
    expect(body).toContain(`set prompt = '${NEW}'`);
    expect(body).toContain(`where prompt = '${OLD}'`);
  });

  test('never inserts a new question row, deletes a row, or touches answers', () => {
    expect(body).not.toMatch(/\binsert\b/i);
    expect(body).not.toMatch(/\bdelete\b/i);
    expect(body).not.toMatch(/\bdrop\b/i);
    expect(body).not.toMatch(/profile_conversation_starters/i);
  });

  test('skips the update when the new wording already exists (unique prompt)', () => {
    expect(body).toMatch(/not exists\s*\(\s*select 1 from public\.conversation_starter_prompts\s+where prompt = '[^']*without\?'/i);
  });
});
