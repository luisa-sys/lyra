/**
 * KAN-181: regression guards for the conversation-starter prompt
 * surface area.
 *
 * Static-grep tests in the style of `current-problems-category.test.ts`
 * — cheap and catch the regressing case of an accidental drop of the
 * wizard step, the public render, or one of the actions. Combined with
 * the migration, the wizard step, the public render, and the actions
 * file all referencing each other by name, these tests give wide
 * coverage with very little maintenance burden.
 *
 * The harder behavioural tests (DB cap, RLS denial for non-owner) are
 * left to the integration-test pass; static guards keep the unit suite
 * quick and CI green-cycles fast.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

describe('KAN-181 conversation starters — surface-area regression guards', () => {
  test('migration file exists and creates both tables', () => {
    const src = readFileSync(
      resolve(ROOT, 'supabase/migrations/20260516200000_conversation_starters.sql'),
      'utf-8',
    );
    expect(src).toMatch(/create table.*conversation_starter_prompts/i);
    expect(src).toMatch(/create table.*profile_conversation_starters/i);
  });

  test('migration seeds at least 8 prompts', () => {
    const src = readFileSync(
      resolve(ROOT, 'supabase/migrations/20260516200000_conversation_starters.sql'),
      'utf-8',
    );
    const matches = src.match(/^\s*\(['"]/gm);
    // Each seed row starts with an open paren + quote — count them as
    // a proxy for the seed-row count.
    expect(matches).not.toBeNull();
    expect((matches ?? []).length).toBeGreaterThanOrEqual(8);
  });

  test('migration enforces the 5-answer cap via a BEFORE INSERT trigger', () => {
    const src = readFileSync(
      resolve(ROOT, 'supabase/migrations/20260516200000_conversation_starters.sql'),
      'utf-8',
    );
    expect(src).toMatch(/limit \(5\) reached/i);
    expect(src).toMatch(/before insert on public\.profile_conversation_starters/i);
  });

  test('migration enforces 500-char answer limit via CHECK', () => {
    const src = readFileSync(
      resolve(ROOT, 'supabase/migrations/20260516200000_conversation_starters.sql'),
      'utf-8',
    );
    expect(src).toMatch(/check \(length\(answer\) <= 500/i);
  });

  test('migration enforces unique (profile_id, prompt_id)', () => {
    const src = readFileSync(
      resolve(ROOT, 'supabase/migrations/20260516200000_conversation_starters.sql'),
      'utf-8',
    );
    expect(src).toMatch(/unique\s*\(\s*profile_id\s*,\s*prompt_id\s*\)/i);
  });

  test('server-actions file exports the three CRUD functions', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/dashboard/profile/conversation-starters-actions.ts'),
      'utf-8',
    );
    expect(src).toMatch(/export\s+async\s+function\s+addConversationStarter/);
    expect(src).toMatch(/export\s+async\s+function\s+updateConversationStarter/);
    expect(src).toMatch(/export\s+async\s+function\s+removeConversationStarter/);
  });

  test('server-actions file uses sanitiseText and a 500-char cap', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/dashboard/profile/conversation-starters-actions.ts'),
      'utf-8',
    );
    expect(src).toMatch(/sanitiseText/);
    expect(src).toMatch(/500/);
  });

  test('server-actions file surfaces the 5-answer cap as a clean error', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/dashboard/profile/conversation-starters-actions.ts'),
      'utf-8',
    );
    expect(src).toMatch(/limit \(5\)/);
    expect(src).toMatch(/up to 5/);
  });

  test('wizard step component exists', () => {
    expect(existsSync(
      resolve(ROOT, 'src/app/dashboard/profile/steps/conversation-starters-step.tsx'),
    )).toBe(true);
  });

  test('public profile page references the conversation starters table', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/[slug]/page.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/profile_conversation_starters/);
    expect(src).toMatch(/Things to ask me about/);
  });

  test('dashboard profile page fetches conversation starter data', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/dashboard/profile/page.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/conversation_starter_prompts/);
    expect(src).toMatch(/profile_conversation_starters/);
  });
});
