/**
 * Test regression guard
 * KAN-110 (original) + KAN-168 (refresh + add count floor)
 *
 * This test ensures the total test count and test file count never drop
 * below known floors. A quietly-deleted test would otherwise pass CI
 * silently — the integrity policy in CLAUDE.md forbids that.
 *
 * Update the floors when consolidating tests intentionally. Per KAN-168,
 * floors are set to (current count - 1) so legitimate consolidation works
 * but a single accidental test deletion is caught.
 */

const { execSync } = require('child_process');
const path = require('path');

// One definition, shared with tests/unit/test-meta-integrity.test.js and
// scripts/gen-test-floor.mjs. See tests/support/transient-probes.json.
const TRANSIENT_PROBE_RE = new RegExp(
  require('../support/transient-probes.json').pattern,
);
const fs = require('fs');

const REPO_ROOT = path.join(__dirname, '../..');

describe('KAN-110 + KAN-168: Test count regression guard', () => {
  // The floor is a GENERATED BASELINE, not two hand-typed constants.
  //
  // It used to be constants with a comment saying "update the floors when
  // consolidating tests intentionally". That was done once, on 2026-05-05, and
  // never again: by 2026-08-09 it enforced 29 files / 320 blocks against an
  // actual 260 / 2963, so ~89% OF THE TEST ESTATE COULD HAVE BEEN DELETED
  // WITHOUT TRIPPING CI. A floor that far below reality is indistinguishable
  // from no floor.
  //
  // It was independently flagged in four places and fixed in none, so more
  // flagging was never going to work — the number had to stop depending on
  // someone remembering.
  //
  // Regenerate with: npm run gen:test-floor
  const baseline = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'tests/support/test-floor-baseline.json'), 'utf8'),
  );

  /** Same measurement the generator uses, so the two cannot disagree. */
  function measure() {
    const listed = execSync(
      "npx jest --testPathPatterns='tests/(unit|scripts)' --listTests",
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    // Exclude TRANSIENT PROBES. Several guard suites prove their subject by
    // writing a probe file into tests/unit/, running the checker, and deleting
    // it. Jest runs suites in PARALLEL, so `--listTests` can observe a probe
    // that is gone by the time we read it — an ENOENT with nothing to do with
    // the test floor. That exact flake already 'failed five unrelated PRs in a
    // row' once (see tests/unit/test-meta-integrity.test.js) and was
    // reproduced here because the pattern was a private const rather than a
    // shared fact. It is now one definition, in transient-probes.json.
    const files = listed
      .trim()
      .split('\n')
      .filter(Boolean)
      .filter((f) => !TRANSIENT_PROBE_RE.test(path.basename(f)));
    let blocks = 0;
    for (const f of files) {
      let content;
      try {
        content = fs.readFileSync(f, 'utf8');
      } catch (err) {
        // Closes the remaining window between listing and reading. Only ENOENT
        // — anything else is a real problem and must not be swallowed, because
        // silently skipping files is how a floor guard stops guarding.
        if (err.code === 'ENOENT') continue;
        throw err;
      }
      blocks += (content.match(/^[ \t]*(test|it)\(/gm) || []).length;
    }
    return { files: files.length, blocks };
  }

  test('the baseline is not vacuous', () => {
    // If the baseline were ever regenerated against an empty or broken jest
    // run, every assertion below would pass over nothing — which is precisely
    // the failure this whole guard exists to prevent, one level up.
    expect(baseline.test_files).toBeGreaterThan(100);
    expect(baseline.test_blocks).toBeGreaterThan(1000);
  });

  test('no test FILE was deleted', () => {
    expect(measure().files).toBeGreaterThanOrEqual(baseline.test_files);
  });

  test('no test BLOCK was deleted', () => {
    expect(measure().blocks).toBeGreaterThanOrEqual(baseline.test_blocks);
  });

  test('the baseline is not STALE — it must rise when tests are added', () => {
    // The half that actually fixes the 50-day drift. Without it the baseline
    // silently falls behind again and quietly overstates how much of the
    // estate is protected, which is exactly how it reached 89% headroom.
    // Adding a test means running `npm run gen:test-floor` in the same commit.
    const now = measure();
    expect(now.files).toBe(baseline.test_files);
    expect(now.blocks).toBe(baseline.test_blocks);
  });

  test('jest config has coverage collection configured', () => {
    const configPath = path.join(REPO_ROOT, 'jest.config.js');
    const content = fs.readFileSync(configPath, 'utf8');
    expect(content).toContain('collectCoverageFrom');
    expect(content).toContain('coverageDirectory');
  });
});
