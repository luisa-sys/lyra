/**
 * KAN-404 (#12) — inline item-edit UI contract.
 *
 * The behavioural coverage for the `updateProfileItem` server action lives in
 * tests/unit/moderation-actions.test.ts (moderation + write) and
 * tests/unit/profile-ownership.test.ts (owner-scope + auth). This file guards
 * the UI wiring at the source level (the repo's jest env is `node`, so the
 * React row can't be rendered — same pattern as affiliations-and-autosave).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SRC } from '../support/source-paths';
import { stripComments } from '../support/strip-comments';

const ROOT = resolve(__dirname, '../..');
const PROFILE = resolve(ROOT, SRC.profile);

// KAN-487 part 3 (founder sign-off 2026-11-23, chat): this describe read the
// legacy wizard's `steps/items-step.tsx`, which is deleted. Inline item
// editing is live in the v0.8 editor's `editor/item-list-editor.tsx`, so the
// four tests are repointed there. v0.8 changes the model (spec §1): a row edit
// updates the editor state and goes out with the one Save, so there is no
// per-row onEdit/Save/Cancel — the live counterparts are Edit (expand),
// Done (collapse), errors shown in place, and every field patched into state.
// Comments are stripped, so the file's own prose cannot satisfy them.
// Old expected values, on items-step.tsx:
//   /onEdit\?:/, /Promise<\{\s*success:\s*boolean;\s*error\?:\s*string\s*\}>/
//   /onEdit && \(/, /onClick=\{\(\) => startEdit\(item\)\}/
//   /saveEdit\(item\.id\)/, /onClick=\{cancelEdit\}/, /editError/
//   /title:\s*editTitle\.trim\(\)/, /description:\s*editDesc/, /url:\s*editUrl\.trim\(\)/
describe('KAN-404 (#12) / KAN-487: editor list rows edit inline', () => {
  const src = stripComments(readFileSync(resolve(PROFILE, 'editor/item-list-editor.tsx'), 'utf-8'));

  test('a row edit updates the editor state (no per-row save callback)', () => {
    expect(src).toMatch(/dispatch\(\{ type: 'updateRow', listKey, key: row\.key, patch: p \}\)/);
    expect(src).not.toMatch(/onEdit/);
  });

  test('renders an Edit button that expands the row in place', () => {
    expect(src).toMatch(/aria-label=\{`Edit \$\{label \|\| 'entry'\}`\}/);
    expect(src).toMatch(/setOpen\(row\.key, true\);/);
  });

  test('inline edit mode has Done and surfaces field errors in place', () => {
    expect(src).toMatch(/setOpen\(row\.key, false\);[\s\S]{0,200}?>\s*Done\s*</);
    expect(src).toMatch(/error: errors\[`\$\{row\.key\}\.title`\]/);
    expect(src).toMatch(/error=\{errors\[`\$\{row\.key\}\.description`\]\}/);
    expect(src).toMatch(/error=\{errors\[`\$\{row\.key\}\.url`\]\}/);
  });

  test('title, description and url are each patched, so a member can clear as well as edit', () => {
    expect(src).toMatch(/onChange: \(v: string\) => patch\(\{ title: v \}\)/);
    expect(src).toMatch(/onChange=\{\(v\) => patch\(\{ description: v \}\)\}/);
    expect(src).toMatch(/onChange=\{\(v\) => patch\(\{ url: v \}\)\}/);
  });
});

describe('KAN-404 (#12): editor wires updateProfileItem into ItemsStep', () => {
  const src = readFileSync(resolve(PROFILE, 'edit-profile-form.tsx'), 'utf-8');

  // KAN-487 (spec v0.8 §1: edits stay in the editor until one atomic save).
  // Inline edits no longer call updateProfileItem per row; every change goes
  // out in the single save payload (saveProfileChanges / saveProfileDraft).
  // Old expected values:
  //   toMatch /updateProfileItem/
  //   toMatch /onEdit=\{async \(id, data\) =>/
  //   toMatch /await updateProfileItem\(id, data\)/
  //   toMatch /return \{ success: res\.success/
  // (founder standing approval 2026-11-23: v0.8 contradicts)
  test('no longer imports updateProfileItem; saves through saveProfileChanges', () => {
    expect(src).not.toMatch(/updateProfileItem/);
    expect(src).toMatch(/import \{[^}]*\bsaveProfileChanges\b[^}]*\} from '\.\/editor-actions'/);
  });

  test('passes an onEdit that calls updateProfileItem and returns the result', () => {
    expect(src).not.toMatch(/onEdit=/);
    expect(src).toMatch(/return saveProfileChanges\(a\.payload\)/);
  });
});

describe('KAN-404 (#12): updateProfileItem action shape', () => {
  const src = readFileSync(resolve(PROFILE, 'actions.ts'), 'utf-8');

  test('exports updateProfileItem returning ItemActionResult', () => {
    expect(src).toMatch(/export type ItemActionResult/);
    expect(src).toMatch(/export async function updateProfileItem/);
  });

  test('is owner-scoped (double .eq) and moderates title + description', () => {
    expect(src).toMatch(/\.eq\('id', itemId\)\s*\n\s*\.eq\('profile_id', profile\.id\)/);
    expect(src).toMatch(/field:\s*'profile_items\.title'/);
    expect(src).toMatch(/field:\s*'profile_items\.description'/);
  });
});
