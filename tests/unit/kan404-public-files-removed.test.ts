/**
 * KAN-404 — public-profile Files & media removal guard.
 *
 * The "Files & media" editor surface was removed from the profile editor
 * (#416), but the public profile at src/app/[slug]/page.tsx still fetched
 * `profile_files` and rendered a "Files & media" <section>, breaking the
 * redesign's "edit == published" invariant. This static source-content guard
 * asserts the public page no longer references either, so a future change that
 * re-introduces the surface fails CI.
 *
 * These are file-content checks (not DB-execution / render tests): a cheap,
 * deterministic backstop for the (staging-only, fixture-gated) e2e assertion.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const PUBLIC_PROFILE_PAGE = join(
  __dirname,
  '../../src/app/[slug]/page.tsx',
);

describe('KAN-404 — public profile no longer renders Files & media', () => {
  const source = readFileSync(PUBLIC_PROFILE_PAGE, 'utf8');

  test('does not query the profile_files table', () => {
    expect(source).not.toContain('profile_files');
  });

  test('does not render a "Files & media" section', () => {
    expect(source).not.toContain('Files & media');
    expect(source).not.toContain('Files &amp; media');
  });

  test('retains the retained-by-design "My boundaries" Manual-of-Me box', () => {
    // KAN-404 explicitly keeps the MoM boundaries box — guard against an
    // over-eager removal taking it out alongside the files surface.
    expect(source).toContain('My boundaries');
    expect(source).toContain('boundaries');
  });
});
