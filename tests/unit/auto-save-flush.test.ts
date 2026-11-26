/**
 * KAN-404 (#8/#9) — coverage for the save-model rework.
 *
 * KAN-487 part 3 (founder sign-off 2026-11-23, chat): the autosave estate is
 * deleted — `sections/use-auto-save.tsx`, `sections/auto-save-core.ts`
 * (`runSave`), `sections/section-save-bar.tsx`, the three autosave section
 * components, the wizard list steps and `wizard.tsx`. Every test in this file
 * that read or imported one of them pinned deleted code and is deleted with
 * it: the five `runSave` status-transition tests, the four `useAutoSave`
 * source guards, the `SectionSaveBar` guard, the three-file autosave-section
 * `test.each`, the four-file `showContinue` `test.each`, and the
 * "legacy wizard.tsx does NOT pass showContinue" guard.
 *
 * What remains is the one test that describes LIVE behaviour: the v0.8 editor
 * has no autosave and saves through one action bar (spec v0.8 §1).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SRC } from '../support/source-paths';

const ROOT = resolve(__dirname, '../..');

describe('KAN-404 / KAN-487: the editor has no autosave and one action bar', () => {
  // KAN-487 (spec v0.8 §1: no autosave; one Save Draft / Save Changes for
  // all sections). The live editor no longer renders the wizard list steps,
  // their Continue buttons, useAutoSave or SectionSaveBar. Old expected value:
  //   (src.match(/showContinue=\{false\}/g) || []).length >= 3  // items + links + starters
  // (founder standing approval 2026-11-23: v0.8 contradicts)
  test('single-page editor renders no list steps (no showContinue, no autosave) and one action bar', () => {
    const src = readFileSync(
      resolve(ROOT, SRC.editProfileForm),
      'utf-8',
    );
    expect(src).not.toMatch(/showContinue=/);
    expect(src).not.toMatch(/useAutoSave/);
    expect(src).not.toMatch(/SectionSaveBar/);
    expect(src).toContain('<EditorActionBar');
  });
});
