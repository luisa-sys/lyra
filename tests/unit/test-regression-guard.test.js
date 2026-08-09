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
    const files = listed.trim().split('\n').filter(Boolean);
    let blocks = 0;
    for (const f of files) {
      const content = fs.readFileSync(f, 'utf8');
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
