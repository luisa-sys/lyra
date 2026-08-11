/**
 * BUGS-74 regression guard — every page that LOADS profile_manual_of_me must
 * load EVERY field in MANUAL_OF_ME_FIELDS.
 *
 * The bug: the single-page profile editor selected only the four v1 columns.
 * The two KAN-263 fields (good_to_know, boundaries) were never fetched, so the
 * editor seeded them as '' and its whole-draft autosave wrote NULL over saved
 * member text on the first edit to ANY field. Silent, member-visible data loss
 * — live on develop, staging, beta and production.
 *
 * The general lesson this guards: a page that loads a SUBSET of an allowlisted
 * field set and saves the WHOLE form back will silently delete the difference.
 * These tests fail the moment a loader drifts from the allowlist again, which
 * is the only thing that would have caught the original defect.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { MANUAL_OF_ME_FIELDS } from '@/modules/profile/manual-of-me-fields';
import { SRC } from '../support/source-paths';

/** Pull the `.select(...)` argument attached to the profile_manual_of_me query. */
function manualOfMeSelectArg(source: string, file: string): string {
  const from = source.indexOf("from('profile_manual_of_me')");
  if (from === -1) {
    throw new Error(`No profile_manual_of_me query found in ${file}`);
  }
  const after = source.slice(from);
  const match = after.match(/\.select\(\s*([\s\S]*?)\s*\)/);
  if (!match) {
    throw new Error(`No .select() found after the profile_manual_of_me query in ${file}`);
  }
  return match[1];
}

/**
 * A loader is safe if it either derives the column list from the shared
 * allowlist (drift-proof by construction) or spells out every field literally.
 */
function assertCoversEveryField(selectArg: string, file: string): void {
  const derived = selectArg.includes('MANUAL_OF_ME_FIELDS');
  if (derived) return;

  const missing = MANUAL_OF_ME_FIELDS.filter((f) => !selectArg.includes(f));
  if (missing.length > 0) {
    throw new Error(
      `${file} selects a literal column list that is missing: ${missing.join(', ')}. ` +
        'A field that is loaded-but-not-selected is silently NULLed by the section ' +
        'autosave (BUGS-74). Add the field, or derive the select from MANUAL_OF_ME_FIELDS.',
    );
  }
}

const LOADERS = [
  { label: 'profile editor', path: SRC.profilePage },
  { label: 'public profile', path: SRC.slugPage },
  // BUGS-74 follow-up: the legacy step-by-step editor carried the identical
  // four-column select and was missed by the original fix. It is the live
  // rollback path, so leaving it drifted meant a rollback would resume the
  // data loss. Every loader belongs in this list, not just the default one.
  { label: 'legacy profile editor', path: SRC.legacyPage },
];

describe('BUGS-74 — profile_manual_of_me loaders cover the full allowlist', () => {
  test.each(LOADERS)('$label ($path) loads every allowlisted field', ({ path }) => {
    const abs = resolve(__dirname, '../..', path);
    if (!existsSync(abs)) {
      throw new Error(`Expected loader not found at ${abs}`);
    }
    const source = readFileSync(abs, 'utf-8');
    const selectArg = manualOfMeSelectArg(source, path);
    expect(() => assertCoversEveryField(selectArg, path)).not.toThrow();
  });

  test('the allowlist still has the two fields the editor used to drop', () => {
    // If these are ever removed the tests above would vacuously pass.
    expect(MANUAL_OF_ME_FIELDS).toContain('good_to_know');
    expect(MANUAL_OF_ME_FIELDS).toContain('boundaries');
    expect(MANUAL_OF_ME_FIELDS.length).toBe(6);
  });

  test('the guard itself catches a drifted literal select', () => {
    // Proves these assertions are not vacuous: the pre-fix editor select
    // (four columns) must be rejected.
    expect(() =>
      assertCoversEveryField(
        "'communication_style, working_preferences, energises_me, drains_me'",
        'fixture',
      ),
    ).toThrow();
  });
});
