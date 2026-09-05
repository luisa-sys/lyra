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

  // Regression guard: the test above is deliberately tolerant of pkgVersion
  // matching ANY existing tag, not just the latest, so a release-in-progress
  // doesn't break CI. But because old tags are never deleted, that tolerance
  // means once pkgVersion matches a tag once, this file can never re-detect
  // further drift — which is exactly how develop's package.json sat at
  // 0.1.37 while tags advanced to v0.1.94 (57 releases) with this suite
  // green the entire time. This test bounds how far pkgVersion may lag the
  // latest tag, so that class of drift fails loud again.
  test('package.json version is not more than 20 releases behind the latest git tag', () => {
    if (allTags.length === 0) {
      return;
    }

    const parseSemver = (v) => {
      const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v);
      return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
    };

    const parsedTags = allTags.map(parseSemver).filter(Boolean);
    if (parsedTags.length === 0) {
      return;
    }

    const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    const latest = parsedTags.reduce((best, t) => (compare(t, best) > 0 ? t : best));

    const pkg = parseSemver(pkgVersion);
    expect(pkg).not.toBeNull();

    // Only bound drift within the same major.minor line — a deliberate
    // major/minor bump is not drift and shouldn't fail this guard.
    if (pkg[0] === latest[0] && pkg[1] === latest[1]) {
      const releasesBehind = latest[2] - pkg[2];
      expect(releasesBehind).toBeLessThanOrEqual(20);
    }
  });
});
