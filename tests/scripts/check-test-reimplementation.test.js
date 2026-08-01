/**
 * Guard test for CTL-038 (scripts/check-test-reimplementation.py).
 *
 * WHY A GUARD TEST AND NOT JUST THE CI STEP
 * -----------------------------------------
 * SEC-79 is the precedent: `health-check.yml` and `weekly-report.yml` sat
 * disabled for over a month while still reporting green. A control's own
 * correctness has to be asserted somewhere that fails loudly, not left to the
 * workflow step that invokes it.
 *
 * This runs the script's `--self-test`, which pins:
 *   - the BUGS-85 shape (subject never reached)          -> vacuous
 *   - importing the subject                              -> partial
 *   - driving it via subprocess                          -> partial
 *   - naming it only as `SRC.<key>`                      -> partial
 *   - an UNRELATED subprocess call in the same file      -> vacuous
 *   - generic names (setup/run/main)                     -> not reported
 *
 * The last two are the blind spots this control shipped with, both caught
 * while building it and both pinned so they cannot recur (SEC-101 §3a).
 */
const { execFileSync, spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = resolve(__dirname, '../..');
const SCRIPT = resolve(ROOT, 'scripts/check-test-reimplementation.py');
const BASELINE = resolve(ROOT, 'tests/support/test-reimplementation-baseline.json');

function run(args, opts = {}) {
  return spawnSync('python3', [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    ...opts,
  });
}

describe('CTL-038 — test-reimplementation ratchet', () => {
  it('passes its own self-test', () => {
    // Fixtures for every classification the control makes, including the two
    // blind spots it shipped with.
    const r = run(['--self-test']);
    expect(r.stdout).toContain('self-test: OK');
    expect(r.status).toBe(0);
  });

  it('is green against the committed baseline', () => {
    const r = run([]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('none new, none stale');
  });

  it('fails CLOSED (exit 2) when the baseline is absent', () => {
    // Not by "never creating it" — that assertion silently inverts once the
    // file is tracked, which is exactly how F8's fail-closed case broke. Move
    // the real file aside so the absence is genuine.
    const tmp = resolve(os.tmpdir(), `ctl038-baseline-${process.pid}.json`);
    fs.renameSync(BASELINE, tmp);
    try {
      const r = run([]);
      // A ratchet with no baseline cannot tell "clean" from "not measured".
      expect(r.status).toBe(2);
      expect(r.stdout).toContain('Failing closed');
    } finally {
      fs.renameSync(tmp, BASELINE);
    }
  });

  it('is registered in controls/registry.json and wired into CI', () => {
    const registry = JSON.parse(
      fs.readFileSync(resolve(ROOT, 'controls/registry.json'), 'utf-8'),
    );
    const ctl = registry.controls.find((c) => c.id === 'CTL-038');
    expect(ctl).toBeDefined();
    expect(ctl.implementation).toBe('scripts/check-test-reimplementation.py');
    expect(ctl.prevents).toContain('BUGS-85');

    // SEC-79: a registered control nothing invokes is the failure mode.
    const wf = fs.readFileSync(
      resolve(ROOT, '.github/workflows/pr-checks.yml'),
      'utf-8',
    );
    expect(wf).toContain('scripts/check-test-reimplementation.py --self-test');
    expect(wf).toContain('scripts/check-test-reimplementation.py\n');
  });

  it('still detects the BUGS-85 defect it was built for', () => {
    // The mutation-proof, run as a test rather than asserted in a commit
    // message: maintenance-page.test.js must remain classified `vacuous` until
    // it is actually fixed. If someone "fixes" it by deleting the baseline
    // entry, the stale check fails instead.
    const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf-8'));
    const bugs85 = baseline.findings.find((f) =>
      f.test.endsWith('maintenance-page.test.js'),
    );
    expect(bugs85).toBeDefined();
    expect(bugs85.severity).toBe('vacuous');
    expect(bugs85.subject).toBe('scripts/lyra-maintenance-worker.js');
    expect(bugs85.shared).toContain('isValidEmail');
  });

  it('reports a NEW reimplementation as a failure', () => {
    // The control must be seen to fail. `git ls-files` cannot see an unstaged
    // file (CLAUDE.md Phase-0 trap 1), so the fixture is staged, checked, then
    // unstaged — otherwise this passes vacuously, which is the very defect
    // CTL-038 exists to catch.
    const rel = 'tests/unit/__ctl038_probe__.test.js';
    const abs = resolve(ROOT, rel);
    fs.writeFileSync(
      abs,
      "const { SRC } = require('../support/source-paths.json');\n" +
        'function isValidEmail(e) { return true; }\n' +
        "test('probe', () => {\n" +
        "  require('fs').readFileSync(SRC.lyraMaintenanceWorker, 'utf8');\n" +
        "  expect(isValidEmail('a')).toBe(true);\n" +
        '});\n',
    );
    try {
      execFileSync('git', ['add', '--intent-to-add', rel], { cwd: ROOT });
      const r = run([]);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('NEW:');
      expect(r.stdout).toContain('__ctl038_probe__');
    } finally {
      spawnSync('git', ['rm', '-q', '--cached', '--force', rel], { cwd: ROOT });
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    }

    // And the tree is clean again afterwards.
    expect(run([]).status).toBe(0);
  });
});
