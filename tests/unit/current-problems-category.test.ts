/**
 * KAN-182: regression guards for the `current_problems` item_category
 * surface-area changes.
 *
 * The enum value is added by the migration (in all three Supabase
 * projects) but each environment that touches it in TS needs to
 * acknowledge it explicitly:
 *
 *   - dashboard wizard categoryLabels (so the user sees a label)
 *   - dashboard wizard step-9 `categories` array (so the user can add)
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
  test('dashboard items-step has a categoryLabel for current_problems', () => {
    const src = readFileSync(
      resolve(ROOT, SRC.itemsStep),
      'utf-8',
    );
    expect(src).toMatch(/current_problems\s*:\s*['"`][^'"`]+['"`]/);
  });

  test('dashboard wizard step 9 lists current_problems', () => {
    const src = readFileSync(
      resolve(ROOT, SRC.wizard),
      'utf-8',
    );
    // The categories prop on step 9's ItemsStep — match the array entry.
    expect(src).toMatch(/categories\s*=\s*\{[^}]*current_problems/);
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
