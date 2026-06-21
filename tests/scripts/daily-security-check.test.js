const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT = path.resolve(__dirname, '../../scripts/daily-security-check.sh');

describe('scripts/daily-security-check.sh', () => {
  let source = '';

  beforeAll(() => {
    source = fs.readFileSync(SCRIPT, 'utf8');
  });

  it('exists and is a bash script', () => {
    expect(fs.existsSync(SCRIPT)).toBe(true);
    expect(source.startsWith('#!/usr/bin/env bash')).toBe(true);
  });

  it('is syntactically valid (bash -n)', () => {
    // Throws on a syntax error; passing means the parser accepted it.
    expect(() => execSync(`bash -n "${SCRIPT}"`, { stdio: 'pipe' })).not.toThrow();
  });

  it('is hardened with set -uo pipefail', () => {
    expect(source).toMatch(/set -uo pipefail/);
  });

  it('never silent-skips: no "|| echo" placeholder-masking pattern', () => {
    // Workflow & Backup Integrity Policy: an error must never be masked by a
    // placeholder echo. Unreachable hosts must be reported UNVERIFIED instead.
    expect(source).not.toMatch(/\|\|\s*echo\s*"/);
  });

  it('treats an unreachable host as UNVERIFIED, not PASS', () => {
    expect(source).toMatch(/UNVERIFIED/);
    expect(source).toMatch(/code="000"/);
  });

  it('emits all three statuses and a machine-readable summary', () => {
    expect(source).toMatch(/\bPASS\b/);
    expect(source).toMatch(/\bFAIL\b/);
    expect(source).toMatch(/# summary/);
  });

  it('exits non-zero on FAIL (2) and on UNVERIFIED-only (1)', () => {
    expect(source).toMatch(/exit 2/);
    expect(source).toMatch(/exit 1/);
  });

  it('defines every expected probe id', () => {
    for (const id of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A6b', 'A9', 'C1', 'C2', 'C7']) {
      // Each id is referenced in at least one record() call.
      expect(source).toContain(` ${id} `);
    }
  });

  it('is read-only: no obvious mutating verbs against prod', () => {
    // Defence-in-depth: the probe script must not contain write-shaped calls.
    expect(source).not.toMatch(/curl[^\n]*-X\s*(PUT|DELETE|PATCH)/);
    expect(source).not.toMatch(/apply_migration|execute_sql|DROP |DELETE FROM |UPDATE /);
  });
});
