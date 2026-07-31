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
import { SRC } from '../support/source-paths';

const ROOT = resolve(__dirname, '../..');

describe('KAN-181 conversation starters — surface-area regression guards', () => {
  test('migration file exists and creates both tables', () => {
    const src = readFileSync(
      resolve(ROOT, SRC.migrations20260516200200ConversationStarters),
      'utf-8',
    );
    expect(src).toMatch(/create table.*conversation_starter_prompts/i);
    expect(src).toMatch(/create table.*profile_conversation_starters/i);
  });

  test('migration seeds at least 8 prompts', () => {
    const src = readFileSync(
      resolve(ROOT, SRC.migrations20260516200200ConversationStarters),
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
      resolve(ROOT, SRC.migrations20260516200200ConversationStarters),
      'utf-8',
    );
    expect(src).toMatch(/limit \(5\) reached/i);
    expect(src).toMatch(/before insert on public\.profile_conversation_starters/i);
  });

  test('migration enforces 500-char answer limit via CHECK', () => {
    const src = readFileSync(
      resolve(ROOT, SRC.migrations20260516200200ConversationStarters),
      'utf-8',
    );
    expect(src).toMatch(/check \(length\(answer\) <= 500/i);
  });

  test('migration enforces unique (profile_id, prompt_id)', () => {
    const src = readFileSync(
      resolve(ROOT, SRC.migrations20260516200200ConversationStarters),
      'utf-8',
    );
    expect(src).toMatch(/unique\s*\(\s*profile_id\s*,\s*prompt_id\s*\)/i);
  });

  test('server-actions file exports the three CRUD functions', () => {
    const src = readFileSync(
      resolve(ROOT, SRC.conversationStartersActions),
      'utf-8',
    );
    expect(src).toMatch(/export\s+async\s+function\s+addConversationStarter/);
    expect(src).toMatch(/export\s+async\s+function\s+updateConversationStarter/);
    expect(src).toMatch(/export\s+async\s+function\s+removeConversationStarter/);
  });

  test('server-actions file uses sanitiseText and a 500-char cap', () => {
    const src = readFileSync(
      resolve(ROOT, SRC.conversationStartersActions),
      'utf-8',
    );
    expect(src).toMatch(/sanitiseText/);
    expect(src).toMatch(/500/);
  });

  test('server-actions file surfaces the answer cap as a clean error', () => {
    const src = readFileSync(
      resolve(ROOT, SRC.conversationStartersActions),
      'utf-8',
    );
    // KAN-404 #14: the actions file now matches the trigger message with a
    // robust regex (any digit count) rather than a hard-coded "limit (5)",
    // and the friendly copy advertises the raised cap of 10.
    expect(src).toMatch(/limit \\\(\\d\+\\\) reached/);
    expect(src).toMatch(/up to 10/);

    // Coverage not weakened: the robust regex the actions file uses must
    // still map the LEGACY 'limit (5) reached' message (e.g. a stale DB
    // env pre-migration) as well as the new 'limit (10) reached'.
    const capRegex = /limit \(\d+\) reached/;
    expect(capRegex.test('Conversation-starter answer limit (5) reached')).toBe(true);
    expect(capRegex.test('Conversation-starter answer limit (10) reached')).toBe(true);
  });

  test('wizard step component exists', () => {
    expect(existsSync(
      resolve(ROOT, SRC.conversationStartersStep),
    )).toBe(true);
  });

  test('public profile page references the conversation starters table', () => {
    const src = readFileSync(
      resolve(ROOT, SRC.slugPage),
      'utf-8',
    );
    expect(src).toMatch(/profile_conversation_starters/);
    // KAN-265 redesign renamed the public heading to "A few more things about me".
    expect(src).toMatch(/A few more things about me/);
  });

  test('dashboard profile page fetches conversation starter data', () => {
    const src = readFileSync(
      resolve(ROOT, SRC.profilePage),
      'utf-8',
    );
    expect(src).toMatch(/conversation_starter_prompts/);
    expect(src).toMatch(/profile_conversation_starters/);
  });
});
