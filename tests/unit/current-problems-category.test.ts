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
    const src = readFileSync(
      resolve(ROOT, SRC.slugPage),
      'utf-8',
    );
    // KAN-265 redesign: rendered via an explicit <CardSection> (grouped items +
    // a warm heading) rather than the old categoryLabels / categoryOrder maps.
    expect(src).toMatch(/groupedItems\['current_problems'\]/);
    expect(src).toMatch(/Problems I'm trying to solve/);
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
