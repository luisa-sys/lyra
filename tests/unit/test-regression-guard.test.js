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
  test('test file count meets minimum floor', () => {
    // Current count: 22 unit test files (2026-05-04). Floor at 21 catches
    // single-file deletion; raise this when adding new test files.
    const TEST_FILE_FLOOR = 21;

    const result = execSync('npx jest --testPathPatterns=tests/unit --listTests', {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });

    const testFiles = result.trim().split('\n').filter(Boolean);
    expect(testFiles.length).toBeGreaterThanOrEqual(TEST_FILE_FLOOR);
  });

  test('total test count meets minimum floor', () => {
    // Static-count floor: 269 test()/it() blocks at line starts as of
    // 2026-05-04 (Jest reports 290 because it expands 5 test.each blocks
    // into multiple cases). Floor at 268 catches single-block deletion.
    // We use static count (not a Jest run) to keep this guard fast.
    const TEST_COUNT_FLOOR = 268;

    const listOutput = execSync('npx jest --testPathPatterns=tests/unit --listTests', {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    const testFiles = listOutput.trim().split('\n').filter(Boolean);

    let totalTests = 0;
    for (const file of testFiles) {
      const content = fs.readFileSync(file, 'utf8');
      // Count test()/it() blocks at line starts (allows for indentation).
      // Approximate — doesn't expand `test.each([...])`. Matches Section 6
      // of weekly-report.yml's test-count heuristic so the two stay aligned.
      const matches = content.match(/^[ \t]*(test|it)\(/gm) || [];
      totalTests += matches.length;
    }

    expect(totalTests).toBeGreaterThanOrEqual(TEST_COUNT_FLOOR);
  });

  test('jest config has coverage collection configured', () => {
    const configPath = path.join(REPO_ROOT, 'jest.config.js');
    const content = fs.readFileSync(configPath, 'utf8');
    expect(content).toContain('collectCoverageFrom');
    expect(content).toContain('coverageDirectory');
  });
});
