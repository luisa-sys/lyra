/**
 * KAN-182: regression guards for the `current_problems` item_category
 * surface-area changes.
 *
 * The enum value is added by the migration (in all three Supabase
 * projects) but each environment that touches it in TS needs to
 * acknowledge it explicitly:
 *
 *   - the editor's list table (so the user can add one)
 *   - the editor's §08 section (so the list is rendered)
 *   (KAN-487 part 3: these were the legacy wizard's categoryLabels and
 *   step-9 `categories` array until the wizard was deleted.)
 *   - public profile categoryLabels (so it has a heading)
 *   - public profile categoryIcons (so it has an icon)
 *   - public profile categoryOrder (so it renders in the right place)
 *
 * If any of these gets dropped in a future refactor, items will either
 * fail to render or display with raw enum text. These static grep tests
 * are deliberately lightweight — they catch the drop, not subtle UX
 * regressions.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SRC } from '../support/source-paths';

const ROOT = resolve(__dirname, '../..');

describe('KAN-182 current_problems category — surface-area regression guards', () => {
  // KAN-487 part 3 (founder sign-off 2026-11-23, chat): the legacy wizard
  // (`steps/items-step.tsx`, `wizard.tsx`) is deleted. These two guards are
  // repointed to the live v0.8 editor, which carries the same two properties.
  // Old expected values:
  //   items-step: /current_problems\s*:\s*['"`][^'"`]+['"`]/   (a label)
  //   wizard:     /categories\s*=\s*\{[^}]*current_problems/  (addable)
  test('the editor list table reads and adds current_problems items', () => {
    const src = readFileSync(
      resolve(ROOT, SRC.editorState),
      'utf-8',
    );
    expect(src).toMatch(
      /current_problems:\s*\{\s*categories:\s*\['current_problems'\],\s*newCategory:\s*'current_problems'\s*\}/,
    );
  });

  test('the editor §08 section renders the current_problems list', () => {
    const src = readFileSync(
      resolve(ROOT, SRC.profile, 'editor/section-problems.tsx'),
      'utf-8',
    );
    expect(src).toContain('listKey="current_problems"');
    expect(src).toContain('rows={state.lists.current_problems}');
  });

  test('public profile [slug]/page.tsx renders current_problems with a warm heading', () => {
    // KAN-488: the page renders the v0.8 view model, whose §08 section is built
    // from the current_problems list under the spec heading (curly apostrophe).
    // The rendered heading is asserted in kan488-public-profile-page.test.tsx.
    // Old expected values (on SRC.slugPage):
    //   expect(src).toMatch(/groupedItems\['current_problems'\]/);
    //   expect(src).toMatch(/Problems I'm trying to solve/);
    // (founder standing approval 2026-11-23: v0.8 contradicts the heading)
    const src = readFileSync(
      resolve(ROOT, SRC.publicViewModel),
      'utf-8',
    );
    expect(src).toMatch(/listSection\(state, 'current_problems', 'problems'/);
    expect(src).toMatch(/Problems I’m trying to solve — ideas welcome/);
  });

  test('migration file exists and adds the enum value', () => {
    const src = readFileSync(
      resolve(ROOT, SRC.migrations20260516160000AddCurrentProblemsCategory),
      'utf-8',
    );
    expect(src).toMatch(/alter type item_category add value/i);
    expect(src).toMatch(/current_problems/);
  });
});
