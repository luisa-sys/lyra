const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
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

  // BUGS-51: a non-zero exit from a phase is only a real FAIL when the phase
  // actually ran and a test/assertion failed. A missing Playwright browser or
  // an empty test path is an ENVIRONMENT gap → must be UNVERIFIED, never FAIL,
  // and a genuine assertion failure (even one whose output mentions "install")
  // must still FAIL. These tests drive the real script with stub phase commands
  // via the CMD_<phase> override seam.
  describe('classifies tooling gaps as UNVERIFIED, real failures as FAIL (BUGS-51)', () => {
    let dir = '';
    const stub = (name, body) => {
      const p = path.join(dir, name);
      fs.writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
      return p;
    };
    let res;

    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whr-'));
      // run_phase requires package.json + node_modules to exist in cwd, else it
      // short-circuits to UNVERIFIED before ever running the phase command.
      fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"stub"}');
      fs.mkdirSync(path.join(dir, 'node_modules'));

      const env = {
        ...process.env,
        PHASES: 'browsergap webkitgap notests realfail installword ok',
        // Exact Playwright/Jest tooling-gap output the classifier keys on:
        CMD_browsergap: stub('browsergap.sh',
          'echo "Error: browserType.launch: Executable doesn\'t exist at /opt/pw-browsers/chromium_headless_shell-1223/chrome-headless-shell"; exit 1'),
        CMD_webkitgap: stub('webkitgap.sh',
          'echo "Looks like Playwright was just installed or updated."; echo "Please run the following command to download new browsers: npx playwright install"; exit 1'),
        CMD_notests: stub('notests.sh',
          'echo "No tests found, exiting with code 1"; exit 1'),
        // A genuine assertion failure → must stay FAIL.
        CMD_realfail: stub('realfail.sh',
          'echo "Expected: 1"; echo "Received: 2"; exit 1'),
        // Edge case from the ticket: a real failure whose output merely contains
        // the word "install" must NOT be mistaken for the Playwright prompt.
        CMD_installword: stub('installword.sh',
          'echo "npm install ok, but expect(received).toBe(expected) failed"; exit 1'),
        CMD_ok: stub('ok.sh', 'echo "all good"; exit 0'),
      };
      res = spawnSync('bash', [SCRIPT], { cwd: dir, env, encoding: 'utf8' });
    });

    afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

    const line = (label) =>
      res.stdout.split('\n').find((l) => l.split('\t')[1] === label) || '';

    it('marks a missing Playwright browser binary UNVERIFIED, not FAIL', () => {
      expect(line('browsergap').startsWith('UNVERIFIED')).toBe(true);
      expect(line('webkitgap').startsWith('UNVERIFIED')).toBe(true);
    });

    it('marks an empty test path (No tests found) UNVERIFIED, not FAIL', () => {
      expect(line('notests').startsWith('UNVERIFIED')).toBe(true);
    });

    it('still marks a genuine assertion failure FAIL', () => {
      expect(line('realfail').startsWith('FAIL')).toBe(true);
    });

    it('does not misclassify a real failure that merely mentions "install"', () => {
      expect(line('installword').startsWith('FAIL')).toBe(true);
    });

    it('still marks a passing phase PASS and exits 2 when any phase FAILs', () => {
      expect(line('ok').startsWith('PASS')).toBe(true);
      // realfail + installword are genuine FAILs → overall exit 2.
      expect(res.status).toBe(2);
    });
  });
});
