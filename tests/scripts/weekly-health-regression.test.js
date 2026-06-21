const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT = path.resolve(__dirname, '../../scripts/weekly-health-regression.sh');

describe('scripts/weekly-health-regression.sh', () => {
  let source = '';
  beforeAll(() => { source = fs.readFileSync(SCRIPT, 'utf8'); });

  it('exists, is bash, and is syntactically valid', () => {
    expect(fs.existsSync(SCRIPT)).toBe(true);
    expect(source.startsWith('#!/usr/bin/env bash')).toBe(true);
    expect(() => execSync(`bash -n "${SCRIPT}"`, { stdio: 'pipe' })).not.toThrow();
  });

  it('is hardened and never silent-skips', () => {
    expect(source).toMatch(/set -uo pipefail/);
    expect(source).not.toMatch(/\|\|\s*echo\s*"/);
    expect(source).toMatch(/UNVERIFIED/);
  });

  it('covers the expected phases', () => {
    for (const p of ['lint', 'type-check', 'unit', 'scripts', 'integration', 'e2e', 'build']) {
      expect(source).toContain(p);
    }
  });

  it('exits non-zero on FAIL (2) and UNVERIFIED-only (1)', () => {
    expect(source).toMatch(/exit 2/);
    expect(source).toMatch(/exit 1/);
  });

  it('is READ-ONLY: never deploys, pushes, promotes, or merges', () => {
    // The safety boundary, enforced at test time: this runner must not contain
    // any deploy/push/promote/merge invocation. Those belong to the wrapping
    // routine, and the production promote stays a MANUAL gate.
    expect(source).not.toMatch(/git\s+push/);
    expect(source).not.toMatch(/gh\s+workflow\s+run/);
    expect(source).not.toMatch(/promote-to-production/);
    expect(source).not.toMatch(/vercel\s/);
    expect(source).not.toMatch(/merge_pull_request/);
  });
});
