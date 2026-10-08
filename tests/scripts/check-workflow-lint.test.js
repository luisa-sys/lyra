/**
 * CTL-073 (SEC-106 §3 item 2) — actionlint + zizmor, wired as a two-way ratchet.
 *
 * WHAT IS COVERED HERE, AND WHAT IS NOT.
 *
 *   Ratchet logic  — driven END TO END through the real script via
 *                    --findings-json, against fixture baselines in a temp
 *                    directory. No linter needed, so these cases run
 *                    everywhere and answer the question that actually matters:
 *                    does a new finding fail, and does a fixed-but-still-listed
 *                    one fail too.
 *
 *   The linters     — NOT exercised here, deliberately, and this suite's first
 *                    cut got it wrong: it asserted `--self-test` exits 0, which
 *                    held locally and went RED in CI, because the binaries are
 *                    installed in the workflow-lint STEP and are not on PATH in
 *                    the unit-test step. The fix is not to relax the assertion
 *                    to tolerate exit 2 — that is the silent-skip shape — but to
 *                    split the arms: `--self-test` is hermetic and runs
 *                    anywhere, `--self-test-tools` drives the real binaries and
 *                    reports UNVERIFIED (exit 2) when either is absent. CI runs
 *                    BOTH with the versions pinned; this suite runs the hermetic
 *                    one and asserts CI invokes the other. Same split CTL-066's
 *                    suite makes for its --live arm, and stated rather than
 *                    implied per SEC-106 §4: recording a gap is a finding.
 *
 * The self-test assertion below is a FLOOR on the case count, not an
 * "N/N passed" tally. A tally moves its denominator with its numerator, so it
 * detects a fixture that FAILS and never one that is DELETED (BUGS-102,
 * catalogue failure mode 8).
 */
const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../');
const { SRC } = require('../support/source-paths.json');
const SCRIPT = path.join(ROOT, SRC.checkWorkflowLint);
const BASELINE = path.join(ROOT, SRC.workflowLintBaseline);
const PR_CHECKS = path.join(ROOT, SRC.prChecks);

// The floor. Raise it when cases are added; it may never be lowered to make a
// red build pass.
const SELF_TEST_CASE_FLOOR = 16;

function run(args = [], env = {}) {
  try {
    return {
      exitCode: 0,
      stdout: execFileSync('python3', [SCRIPT, ...args], {
        cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env },
      }),
    };
  } catch (err) {
    return { exitCode: err.status ?? 1, stdout: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

/** Drive the real script against a fixture baseline + fixture findings. */
function check(findings, baselineDoc) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctl073-'));
  const findingsPath = path.join(dir, 'findings.json');
  const baselinePath = path.join(dir, 'baseline.json');
  fs.writeFileSync(findingsPath, JSON.stringify(findings));
  if (baselineDoc !== null) fs.writeFileSync(baselinePath, JSON.stringify(baselineDoc));
  return run(['--findings-json', findingsPath], { WORKFLOW_LINT_BASELINE: baselinePath });
}

const ENTRY = 'zizmor:template-injection:.github/workflows/weekly-report.yml';
const baselineOf = (entries) => ({ tool_versions: {}, entries });

describe('check-workflow-lint.py (CTL-073)', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');

  test('the script exists and is executable', () => {
    expect(fs.existsSync(SCRIPT)).toBe(true);
    expect(fs.statSync(SCRIPT).mode & 0o111).toBeTruthy();
  });

  test('--self-test passes and runs at least the floor number of cases', () => {
    const { exitCode, stdout } = run(['--self-test']);
    const tally = stdout.match(/self-test:\s+(\d+)\/(\d+) passed/);
    // exit 2 means a linter was missing, which is UNVERIFIED — a real result,
    // not a pass. Assert it separately so a machine without the tools cannot
    // be mistaken for a clean run.
    //
    // Matched on the ANNOTATION, not the bare word: one of the self-test case
    // names is "a DIFFERENT tool version is UNVERIFIED…", so a substring match
    // fails on a fully passing run — the same self-inflicted shape BUGS-103 hit
    // with `not.toMatch(/FAIL /)` against case names containing "FAIL".
    expect({ exitCode, unverified: /::error::self-test: UNVERIFIED/.test(stdout) }).toEqual({
      exitCode: 0, unverified: false,
    });
    expect(tally).not.toBeNull();
    expect(Number(tally[1])).toBeGreaterThanOrEqual(SELF_TEST_CASE_FLOOR);
    expect(Number(tally[1])).toBe(Number(tally[2]));
  });

  // -------------------------------------------------------------------------
  // The ratchet, end to end
  // -------------------------------------------------------------------------
  test('findings that match the baseline exactly pass', () => {
    const { exitCode, stdout } = check({ [ENTRY]: 2 }, baselineOf({ [ENTRY]: 2 }));
    expect(exitCode).toBe(0);
    expect(stdout).toContain('matching the baseline exactly');
  });

  test('a NEW finding fails with exit 1', () => {
    const { exitCode, stdout } = check({ [ENTRY]: 1 }, baselineOf({}));
    expect(exitCode).toBe(1);
    expect(stdout).toContain('NEW finding');
    expect(stdout).toContain(ENTRY);
  });

  test('MORE findings under an existing key fails with exit 1', () => {
    const { exitCode, stdout } = check({ [ENTRY]: 3 }, baselineOf({ [ENTRY]: 2 }));
    expect(exitCode).toBe(1);
    expect(stdout).toContain('WORSE');
  });

  test('a fixed-but-still-listed entry fails as STALE — the ratchet is two-way', () => {
    const { exitCode, stdout } = check({}, baselineOf({ [ENTRY]: 2 }));
    expect(exitCode).toBe(1);
    expect(stdout).toContain('STALE baseline entry');
  });

  test('a missing baseline is UNVERIFIED (exit 2), never a clean scan', () => {
    const { exitCode, stdout } = check({ [ENTRY]: 1 }, null);
    expect(exitCode).toBe(2);
    expect(stdout).toContain('UNVERIFIED');
  });

  test('the exit-2 wording warns the reader off hunting a drift (CTL-059)', () => {
    const { stdout } = check({ [ENTRY]: 1 }, null);
    expect(stdout).toContain('This is NOT a drift report');
    // ...and is distinct from the exit-1 wording, so the two cannot be confused.
    expect(stdout).not.toContain('NEW finding');
  });

  test('--self-test-tools reports UNVERIFIED when a linter is absent, never a pass', () => {
    // Environment-independent: point it at a binary that cannot exist. This is
    // the fail-closed contract asserted from the OUTCOME, not inferred from an
    // exit code alone (gotcha #30) — exit 2 AND the annotation.
    const { exitCode, stdout } = run(['--self-test-tools'], {
      ACTIONLINT_BIN: '/nonexistent/actionlint',
    });
    expect(exitCode).toBe(2);
    expect(stdout).toContain('::error::tool-self-test: UNVERIFIED');
    expect(stdout).not.toContain('tool-self-test: 4/4 passed');
  });

  // -------------------------------------------------------------------------
  // The committed baseline
  // -------------------------------------------------------------------------
  describe('the committed baseline', () => {
    const doc = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    const keys = Object.keys(doc.entries || {});
    const tracked = new Set(
      execSync('git ls-files .github/workflows', { cwd: ROOT, encoding: 'utf8' })
        .split('\n').filter(Boolean),
    );

    // Failure mode 4: a parameterised test over an empty list registers ZERO
    // tests, and an empty suite is green. Assert the corpus before iterating.
    test('has a non-empty entry list and records both tool versions', () => {
      expect(keys.length).toBeGreaterThan(10);
      expect(Object.keys(doc.tool_versions || {}).sort()).toEqual(['actionlint', 'zizmor']);
    });

    test.each(keys)('%s is keyed <tool>:<rule>:<tracked workflow path>', (key) => {
      const [tool, rule, ...rest] = key.split(':');
      const file = rest.join(':');
      expect(['actionlint', 'zizmor']).toContain(tool);
      expect(rule).not.toBe('');
      // Relative, and a file git actually tracks — an absolute path would match
      // on one machine and read as a new finding everywhere else.
      expect(path.isAbsolute(file)).toBe(false);
      expect(tracked.has(file)).toBe(true);
    });

    test('the totals are derived, not hand-typed', () => {
      const sum = keys.reduce((n, k) => n + doc.entries[k], 0);
      expect(doc.totals.findings).toBe(sum);
      expect(doc.totals.keys).toBe(keys.length);
    });
  });

  // -------------------------------------------------------------------------
  // Wiring — a control nothing invokes is not a control (SEC-79)
  // -------------------------------------------------------------------------
  test('pr-checks.yml runs BOTH self-test arms and the check, with pinned versions', () => {
    const wf = fs.readFileSync(PR_CHECKS, 'utf8');
    expect(wf).toContain(`python3 ${SRC.checkWorkflowLint} --self-test\n`);
    // The arm this suite cannot run. If CI stops invoking it, the fixture
    // contract of SEC-106 §4d is exercised by nothing at all.
    expect(wf).toContain(`python3 ${SRC.checkWorkflowLint} --self-test-tools`);
    expect(wf).toContain(`python3 ${SRC.checkWorkflowLint}\n`);
    // Pinned, per SEC-105: an unpinned linter is a rule set that changes under
    // an unchanged repo. Both pins must name an exact version, not a range.
    const versions = wf.match(/ACTIONLINT_VERSION: (\S+)|ZIZMOR_VERSION: (\S+)/g) || [];
    expect(versions).toHaveLength(2);
    versions.forEach((v) => expect(v).toMatch(/v?\d+\.\d+\.\d+$/));
  });

  test('the pinned versions in CI are the ones the baseline was measured with', () => {
    const wf = fs.readFileSync(PR_CHECKS, 'utf8');
    const doc = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    // Two places that must agree with nothing comparing them is the SEC-152
    // shape. Compare them.
    expect(wf).toContain(`ACTIONLINT_VERSION: v${doc.tool_versions.actionlint}`);
    expect(wf).toContain(`ZIZMOR_VERSION: ${doc.tool_versions.zizmor}`);
  });

  test('the script states which §1 primitives it does NOT cover', () => {
    // A control that lets its own gap go unrecorded is how "wired in" gets read
    // as "covered". The header table is that record.
    expect(source).toContain('WHAT THESE TWO TOOLS DO AND DO NOT COVER');
    expect(source).toMatch(/continue-on-error[^\n]*NOTHING/);
  });
});
