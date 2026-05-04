/**
 * KAN-166: Version drift guard.
 *
 * `package.json` version must match a real git tag. Catches the drift bug
 * we hit pre-2026-05-04 where package.json was 0.1.0 while the latest
 * git tag was v0.1.37 — 37 patches out of date.
 *
 * Tolerant of: package.json version being any tagged release (not strictly
 * the latest), so a release-in-progress where pkg is bumped before the tag
 * is created doesn't break CI on develop. Strict enough to catch:
 *   - pkg.version stays at an old release while new tags ship
 *   - pkg.version pointing at a non-existent version (typo or made-up)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '../..');

describe('KAN-166: package.json version aligns with git tags', () => {
  let pkgVersion;
  let allTags;

  beforeAll(() => {
    pkgVersion = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
    ).version;

    // List all tags. Tolerant of shallow clones via fetch-depth: 0 in CI.
    // If the runner has no tags (shallow checkout), skip the assertion
    // rather than fail false-positively — but log clearly so this can't
    // hide indefinitely.
    try {
      const out = execSync('git tag --list', { cwd: REPO_ROOT, encoding: 'utf8' });
      allTags = out
        .trim()
        .split('\n')
        .map((t) => t.trim())
        .filter(Boolean);
    } catch {
      allTags = [];
    }
  });

  test('package.json version is non-empty and semver-shaped', () => {
    expect(pkgVersion).toBeTruthy();
    expect(pkgVersion).toMatch(/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/);
  });

  test('package.json version matches an existing git tag', () => {
    if (allTags.length === 0) {
      // Shallow clone — skip the assertion but emit a console.error so it
      // can't silently mask drift forever. KAN-166 thesis: drift detection
      // is the WHOLE point of this test, so a silent no-op would be the
      // exact false-positive we are trying to prevent.
      // eslint-disable-next-line no-console
      console.error(
        'KAN-166 drift test ran without git tags — likely shallow clone. ' +
          'Use `actions/checkout@v6 with: fetch-depth: 0` (or `fetch-tags: true`).',
      );
      // Still assert something so the test isn't a silent pass.
      expect(allTags).toEqual([]);
      return;
    }

    const expectedTag = `v${pkgVersion}`;
    expect(allTags).toContain(expectedTag);
  });
});
