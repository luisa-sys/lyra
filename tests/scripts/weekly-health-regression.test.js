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

/**
 * BUGS-51: a phase whose failure is an ENVIRONMENT GAP (Playwright browsers
 * missing/mismatched, or "No tests found") must be UNVERIFIED (loud, non-zero —
 * never a green pass), while a GENUINE test failure still FAILs. We invoke the
 * real script for a single phase with a fake `npm` shimmed onto PATH so each
 * outcome is deterministic without running the actual suite. Net-new tests —
 * no existing test is modified or weakened (Test Integrity Policy).
 */
describe('weekly-health-regression.sh env-gap classification (BUGS-51)', () => {
  const os = require('os');

  function runPhaseWithFakeNpm(npmBody, phase) {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whr-fakebin-'));
    const npmPath = path.join(binDir, 'npm');
    fs.writeFileSync(npmPath, `#!/usr/bin/env bash\n${npmBody}\n`, { mode: 0o755 });
    let out = '';
    try {
      out = execSync(`bash "${SCRIPT}"`, {
        cwd: path.resolve(__dirname, '../..'),
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, PHASES: phase, RUN_E2E: '0' },
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (e) {
      // Script exits non-zero on FAIL (2) / UNVERIFIED (1); phase lines are on stdout.
      out = `${e.stdout || ''}${e.stderr || ''}`;
    } finally {
      fs.rmSync(binDir, { recursive: true, force: true });
    }
    return out;
  }

  it('classifies a missing/mismatched Playwright browser as UNVERIFIED, not FAIL', () => {
    const out = runPhaseWithFakeNpm(
      `echo "Error: browserType.launch: Executable doesn't exist at /opt/pw-browsers/webkit-2287/pw_run.sh"; exit 1`,
      'e2e',
    );
    expect(out).toMatch(/UNVERIFIED\s+e2e/);
    expect(out).not.toMatch(/FAIL\s+e2e/);
  });

  it('classifies jest "No tests found" as UNVERIFIED, not FAIL', () => {
    const out = runPhaseWithFakeNpm(`echo "No tests found, exiting with code 1"; exit 1`, 'integration');
    expect(out).toMatch(/UNVERIFIED\s+integration/);
    expect(out).not.toMatch(/FAIL\s+integration/);
  });

  it('still reports a genuine assertion failure as FAIL', () => {
    const out = runPhaseWithFakeNpm(
      `echo "expect(received).toBe(expected) -- Tests: 3 failed, 0 passed"; exit 1`,
      'unit',
    );
    expect(out).toMatch(/FAIL\s+unit/);
    expect(out).not.toMatch(/UNVERIFIED\s+unit/);
  });

  it('reports a passing command as PASS', () => {
    const out = runPhaseWithFakeNpm(`echo "all good"; exit 0`, 'lint');
    expect(out).toMatch(/PASS\s+lint/);
  });
});
