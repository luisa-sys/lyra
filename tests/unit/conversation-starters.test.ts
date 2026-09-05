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
import { memberFacingDbError } from '@/modules/profile/db-error-copy';

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
    // BUGS-87: was a source-text scan of the actions file. The cap copy moved
    // to src/modules/profile/db-error-copy.ts, and CTL-039 immediately flagged the
    // relocated scan as comment-shadowed — the copy appears in that module's
    // header AND in its code, so deleting the code would have left the
    // assertion green. So this is now BEHAVIOURAL: it calls the mapper.
    //
    // It also drops the old `limit (\d+) reached` assertion. That pattern was
    // the defect, not the guarantee: it matches 'Profile file limit (10)
    // reached' too, so sharing it would have told a member who hit the
    // ten-FILE cap that they could answer ten prompts. The anchored behaviour
    // below is what actually matters.
    expect(
      memberFacingDbError({ message: 'Conversation-starter answer limit (10) reached' }),
    ).toMatch(/up to 10 prompts/);
    // Anchored, not generic: the file cap must NOT get this copy.
    expect(
      memberFacingDbError({ message: 'Profile file limit (10) reached' }),
    ).not.toMatch(/prompts/);

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
    // KAN-265 named the public heading; KAN-445 renamed it again, to the
    // founder's wording. The old literal also appeared in the JSX comment two
    // lines above the heading, which is why CTL-039 had this assertion
    // baselined as comment-shadowed — the comment no longer repeats the
    // heading, so this now matches the rendered text and nothing else.
    expect(src).toMatch(/A bit more about me/);
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
