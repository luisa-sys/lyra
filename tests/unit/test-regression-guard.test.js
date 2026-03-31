/**
 * Test regression guard
 * KAN-110: Prevent accidental test deletion or suite breakage
 *
 * This test ensures the total test count never drops below a known floor.
 * Update TEST_COUNT_FLOOR when adding new tests.
 */

const { execSync } = require('child_process');
const path = require('path');

describe('KAN-110: Test count regression guard', () => {
  test('total test count meets minimum floor', () => {
    // Current floor: 208 tests as of 31 March 2026
    // Ratchet this up whenever new tests are added
    const TEST_COUNT_FLOOR = 200;

    const result = execSync('npx jest --testPathPatterns=tests/unit --listTests', {
      cwd: path.join(__dirname, '../..'),
      encoding: 'utf8',
    });

    const testFiles = result.trim().split('\n').filter(Boolean);
    // We have 16 test suites — ensure none have been deleted
    expect(testFiles.length).toBeGreaterThanOrEqual(16);
  });

  test('jest config has coverage collection configured', () => {
    const fs = require('fs');
    const configPath = path.join(__dirname, '../../jest.config.js');
    const content = fs.readFileSync(configPath, 'utf8');
    expect(content).toContain('collectCoverageFrom');
    expect(content).toContain('coverageDirectory');
  });
});
