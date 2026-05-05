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
    // KAN-168 refresh 2026-05-05: now 30 unit/script test files (was 22).
    // Floor at 29 catches single-file deletion; raise this when adding
    // new test files.
    const TEST_FILE_FLOOR = 29;

    const result = execSync(
      "npx jest --testPathPatterns='tests/(unit|scripts)' --listTests",
      { cwd: REPO_ROOT, encoding: 'utf8' }
    );

    const testFiles = result.trim().split('\n').filter(Boolean);
    expect(testFiles.length).toBeGreaterThanOrEqual(TEST_FILE_FLOOR);
  });

  test('total test count meets minimum floor', () => {
    // KAN-168 refresh 2026-05-05: now 327 test()/it() blocks at line starts
    // across tests/unit + tests/scripts (Jest reports 319 unit + scripts,
    // 330 incl. e2e). Floor at 320 leaves a small headroom for legitimate
    // refactors but catches large deletions. Increase this floor in the
    // same PR as any net-new-test addition.
    const TEST_COUNT_FLOOR = 320;

    // KAN-168: include tests/scripts (uptimerobot bootstrap test) which
    // is now part of the test:unit run via the broadened jest pattern in
    // package.json.
    const listOutput = execSync(
      "npx jest --testPathPatterns='tests/(unit|scripts)' --listTests",
      { cwd: REPO_ROOT, encoding: 'utf8' }
    );
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
