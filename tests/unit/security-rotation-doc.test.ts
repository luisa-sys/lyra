/**
 * BUGS-15 follow-up: meta-test for docs/SECURITY_ROTATION.md.
 *
 * Background: between BUGS-4 (initial PAT scope = contents:write) and
 * BUGS-15 (final scope = contents:write + pull-requests:write +
 * workflows:write), the rotation procedure section was never updated
 * to list all three scopes. When Luisa rotated the PAT following the
 * outdated instructions on 2026-05-27, the new token was missing two
 * scopes, blocking promote-to-staging for ~30 minutes until manual
 * gh-API workarounds were applied.
 *
 * This test guards against the doc drifting again. If a future PR
 * accidentally drops one of the three required scopes from the
 * rotation procedure, this test fails before the PR can merge.
 *
 * The accompanying smoke-test workflow (.github/workflows/
 * verify-release-pat.yml) catches the runtime version of the same
 * problem: if the token in the GitHub secret is missing a scope, the
 * workflow surfaces which one within ~60 seconds.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const DOC_PATH = resolve(ROOT, 'docs/SECURITY_ROTATION.md');

describe('BUGS-15: SECURITY_ROTATION.md rotation procedure', () => {
  let doc: string;
  let rotationSection: string;

  beforeAll(() => {
    doc = readFileSync(DOC_PATH, 'utf-8');
    // Isolate the "Rotating LYRA_RELEASE_PAT" subsection so this test
    // doesn't pass on incidental mentions elsewhere in the doc (e.g.
    // a paragraph discussing why workflows:write was added).
    const m = doc.match(/### Rotating LYRA_RELEASE_PAT[\s\S]*?(?=\n### |\n## |\Z)/);
    if (!m) {
      throw new Error('Could not find "### Rotating LYRA_RELEASE_PAT" section in SECURITY_ROTATION.md');
    }
    rotationSection = m[0];
  });

  test('rotation section exists and is non-trivial', () => {
    expect(rotationSection.length).toBeGreaterThan(200);
  });

  test('lists Contents:write requirement', () => {
    // Accept either explicit "Contents: Read and write" or the older
    // "Contents → Read and write" arrow form.
    expect(rotationSection).toMatch(/Contents[^.]*Read and write/);
  });

  test('lists Pull-requests:write requirement (BUGS-8)', () => {
    expect(rotationSection).toMatch(/Pull requests[^.]*Read and write/);
  });

  test('lists Workflows:write requirement (BUGS-15)', () => {
    expect(rotationSection).toMatch(/Workflows[^.]*Read and write/);
  });

  test('does NOT contain the misleading old text "no other scope"', () => {
    // The old text was: "Permissions: Contents → Read and write on
    // luisa-sys/lyra ONLY (no other scope)". This phrasing told the
    // reader that any scope beyond Contents was unnecessary — exactly
    // wrong, and the cause of the 2026-05-27 incident. Make sure it
    // doesn't sneak back in.
    expect(rotationSection).not.toMatch(/no other scope/i);
    expect(rotationSection).not.toMatch(/contents:write on luisa-sys\/lyra only/i);
  });

  test('references the verify-release-pat.yml smoke-test workflow', () => {
    // After rotation, the procedure should send the operator straight
    // to the smoke test so a missing scope is caught before the next
    // production promotion blows up.
    expect(rotationSection).toMatch(/verify-release-pat\.yml/);
  });

  test('inventory table row for LYRA_RELEASE_PAT also lists all three scopes', () => {
    // The Infrastructure Secrets table at the top of the doc is what
    // operators eyeball when picking the row to rotate. If that row
    // lists only Contents, they'll set only Contents — even if the
    // procedure section below is correct.
    const tableRow = doc.match(/\| LYRA_RELEASE_PAT \|[^\n]+/);
    expect(tableRow).not.toBeNull();
    if (tableRow) {
      const row = tableRow[0];
      expect(row).toMatch(/Contents/);
      expect(row).toMatch(/Pull requests/);
      expect(row).toMatch(/Workflows/);
    }
  });
});
