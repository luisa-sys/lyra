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

const ROOT = resolve(__dirname, '../..');
const PROFILE = resolve(ROOT, SRC.profile);

describe('KAN-404 (#12): ItemsStep inline edit', () => {
  const src = readFileSync(resolve(PROFILE, 'steps/items-step.tsx'), 'utf-8');

  test('accepts an optional onEdit prop returning success/error', () => {
    expect(src).toMatch(/onEdit\?:/);
    expect(src).toMatch(/Promise<\{\s*success:\s*boolean;\s*error\?:\s*string\s*\}>/);
  });

  test('renders an Edit button only when onEdit is wired', () => {
    expect(src).toMatch(/onEdit && \(/);
    expect(src).toMatch(/onClick=\{\(\) => startEdit\(item\)\}/);
  });

  test('inline edit mode has Save + Cancel and surfaces editError in place', () => {
    expect(src).toMatch(/saveEdit\(item\.id\)/);
    expect(src).toMatch(/onClick=\{cancelEdit\}/);
    expect(src).toMatch(/editError/);
  });

  test('saveEdit sends title/description/url so a user can clear as well as edit', () => {
    expect(src).toMatch(/title:\s*editTitle\.trim\(\)/);
    expect(src).toMatch(/description:\s*editDesc/);
    expect(src).toMatch(/url:\s*editUrl\.trim\(\)/);
  });
});

describe('KAN-404 (#12): editor wires updateProfileItem into ItemsStep', () => {
  const src = readFileSync(resolve(PROFILE, 'edit-profile-form.tsx'), 'utf-8');

  test('imports updateProfileItem', () => {
    expect(src).toMatch(/updateProfileItem/);
  });

  test('passes an onEdit that calls updateProfileItem and returns the result', () => {
    expect(src).toMatch(/onEdit=\{async \(id, data\) =>/);
    expect(src).toMatch(/await updateProfileItem\(id, data\)/);
    expect(src).toMatch(/return \{ success: res\.success/);
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
