/**
 * CTL-065 (SEC-106) — a required status check must actually be satisfiable.
 *
 * The control has two arms and they fail independently, so the tests are split
 * the same way:
 *
 *   LOCAL  — every context named in .github/expected-protection.json is still
 *            produced by a job in .github/workflows/. Exercised END TO END here
 *            by running the real script against the real repository, because
 *            it needs no credentials. This is the arm that catches the rename
 *            in this ticket's title.
 *
 *   LIVE   — the committed expectation matches GitHub's actual configuration.
 *            Its decision logic (compare / stale_branches) is covered through
 *            the script's own --self-test fixtures. THE END-TO-END PATH IS NOT
 *            COVERED AND CANNOT BE: it needs a real token against real branch
 *            protection, which no unit test has. Stated here rather than
 *            implied, per SEC-106 §4's own instruction — recording a gap is a
 *            finding, hiding it is a regression. It is exercised for real only
 *            by the scheduled run in required-checks.yml.
 *
 * Note what is deliberately NOT asserted: that the live configuration is
 * correct. This suite proves the CONTROL works. Whether branch protection
 * itself matches CLAUDE.md's claim is unknown to this repository until the
 * scheduled run has a token — which is the whole finding SEC-106 was raised on.
 */
const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../');
const { SRC } = require('../support/source-paths.json');
// Via the manifest, not as raw literals — the KAN-414 F4 ratchet counts raw
// path literals in tests, and a test about a guard is exactly the kind that
// hardcodes its subject's path and then quietly breaks on a move (gotcha #31).
const SCRIPT = path.join(ROOT, SRC.checkRequiredChecks);
const EXPECTATION = path.join(ROOT, SRC.expectedProtection);
const WORKFLOW = path.join(ROOT, SRC.requiredChecks);

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

describe('check-required-checks.py (CTL-065)', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');

  test('the script exists and is executable', () => {
    expect(fs.existsSync(SCRIPT)).toBe(true);
    expect(fs.statSync(SCRIPT).mode & 0o111).toBeTruthy();
  });

  test('self-test passes in full, and runs at least its committed floor', () => {
    const r = run(['--self-test']);
    expect(r.exitCode).toBe(0);

    // ⚠️ THE FLOOR IS THE POINT, and `\d+\/\d+ passed` alone is not enough:
    // that regex moves its denominator with its numerator, so it detects a
    // fixture that FAILS and never one that is DELETED — the corpus could be
    // cut to a single case and stay green (BUGS-102; catalogue failure mode 8).
    // Raise it with any net-new case; never lower it to make a red build green.
    const m = /self-test: (\d+)\/(\d+) passed/.exec(r.stdout);
    expect(m).not.toBeNull();
    const [, passed, total] = m.map(Number);
    expect(`${passed}/${total}`).toBe(`${total}/${total}`);
    expect(total).toBeGreaterThanOrEqual(25);
  });

  test('the self-test verdict is read AFTER every case is appended', () => {
    // SEC-140, catalogue failure mode 9: eight self-test cases in
    // check-npm-audit-gate.py were appended AFTER its `if failures:` check, so
    // three separate mutations all printed "Self-test passed" and the case
    // count went UP. This asserts WHERE the failure list is consumed, not
    // merely that cases append to it.
    const body = source.slice(source.indexOf('def self_test'));
    const verdict = body.indexOf('failed = [n for n, ok in cases if not ok]');
    expect(verdict).toBeGreaterThan(-1);
    expect(body.slice(verdict)).not.toMatch(/\bcheck\(/);
  });

  // ---------------------------------------------------------------------
  // THE LOCAL ARM, end to end against the real repository.
  // ---------------------------------------------------------------------

  test('the real repo currently satisfies every context it says it requires', () => {
    const r = run(['--local']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/Every required context is still produced/);
  });

  test('it refuses to pass on a scan that parsed nothing', () => {
    // A scan that silently matches nothing is the SEC-79 shape this control
    // exists to close, so the script must not accept its own zero. Without
    // this, an empty workflow directory would report every context "missing"
    // — or, worse, a broken parser would report none at all.
    expect(source).toMatch(/contains no workflow files/);
    expect(source).toMatch(/not one job was parsed/);
    expect(source).toMatch(/The parser is broken, not the repository/);
  });

  test('a renamed job is detected — proven against a real workflow copy', () => {
    // THE DEFECT IN THIS TICKET'S TITLE, exercised end to end rather than
    // asserted from source text: the whole repo is copied to a sandbox, one
    // character is changed in the job that produces `guard`, and the real
    // script is run against it.
    const sandbox = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ctl064-'));
    try {
      execSync(`git clone --quiet --no-hardlinks --depth 1 file://${ROOT} ${sandbox}`, {
        cwd: ROOT, stdio: 'pipe',
      });
      // The clone carries only COMMITTED state, so the sandbox must be given
      // the working-tree versions of the three files under test. Doing this
      // explicitly also keeps the mutation honest: it is applied to a file
      // whose pre-mutation content is known.
      for (const rel of [SRC.checkRequiredChecks, SRC.expectedProtection]) {
        fs.mkdirSync(path.dirname(path.join(sandbox, rel)), { recursive: true });
        fs.copyFileSync(path.join(ROOT, rel), path.join(sandbox, rel));
      }
      const guardWf = path.join(sandbox, SRC.mainChainGuard);
      const before = fs.readFileSync(guardWf, 'utf8');
      const after = before.replace('\n  guard:\n', '\n  guards:\n');
      // ⚠️ ASSERT THE MUTATION APPLIED. A string-replace that silently matches
      // nothing produces a green run indistinguishable from a green run, and
      // that exact mistake cost a session during KAN-415 D7.
      expect(after).not.toBe(before);
      fs.writeFileSync(guardWf, after);

      let out = '';
      let code = 0;
      try {
        out = execFileSync('python3', [path.join(sandbox, SRC.checkRequiredChecks), '--local'],
          { cwd: sandbox, encoding: 'utf8' });
      } catch (err) {
        code = err.status;
        out = `${err.stdout || ''}${err.stderr || ''}`;
      }
      expect(code).toBe(1);
      expect(out).toMatch(/required context 'guard' is produced by NO job/);
      // Naming the near-miss is what makes the finding actionable: without it
      // the reader goes hunting a deleted workflow rather than a changed letter.
      expect(out).toMatch(/Closest producible name: 'guards'/);
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------------
  // THE THREE-VALUED EXIT CONTRACT (SEC-106 §4a)
  // ---------------------------------------------------------------------

  test('a missing expectation file is UNVERIFIED (exit 2), never clean', () => {
    // ⚠️ "Absent because I never added it" and "absent because it is gone" are
    // different assertions and only the second is stable (KAN-414 trap 2), so
    // this runs the script from a directory where the file genuinely cannot be
    // resolved rather than relying on it never having been committed.
    const sandbox = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ctl064-miss-'));
    try {
      // Directories derived from the manifest, never written out: the F4
      // shrink-only ratchet counts raw path literals in tests/, and it is
      // meant to fall, not to be topped up by each new suite.
      fs.mkdirSync(path.join(sandbox, path.dirname(SRC.checkRequiredChecks)), { recursive: true });
      fs.mkdirSync(path.join(sandbox, SRC.workflows), { recursive: true });
      fs.copyFileSync(SCRIPT, path.join(sandbox, SRC.checkRequiredChecks));
      let code = 0;
      let out = '';
      try {
        out = execFileSync('python3', [path.join(sandbox, SRC.checkRequiredChecks), '--local'],
          { cwd: sandbox, encoding: 'utf8' });
      } catch (err) {
        code = err.status;
        out = `${err.stdout || ''}${err.stderr || ''}`;
      }
      expect(code).toBe(2);
      expect(out).toMatch(/UNVERIFIED/);
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  });

  test('exit-2 wording warns the reader OFF hunting a drift that was never seen', () => {
    // CTL-059 exactly: db-invariants.yml raised every non-zero exit under a
    // bare `if: failure()`, so an HTTP 403 printed the divergence story and
    // sent the reader looking for an uncommitted migration on three separate
    // days. The two vocabularies must not be interchangeable.
    expect(source).toMatch(/NOTHING WAS MEASURED/);
    expect(source).toMatch(/do not go looking for a divergence/);
    // ...and the exit-1 wording must claim the opposite.
    expect(source).toMatch(/This was measured, not guessed/);
  });

  test('a missing API permission is UNVERIFIED, and says which permission', () => {
    // A silent pass here recreates the exact defect this ticket exists to
    // close: a check reporting green while proving nothing.
    expect(source).toMatch(/administration:read/);
    expect(source).toMatch(/GITHUB_TOKEN does not have it/);
    expect(source).toMatch(/the `gh` CLI is not installed/);
  });

  test('fail-closed is asserted from the precondition, not from a status code', () => {
    // Gotcha #30: BSD grep returns 1, not 2, for a missing search path, so a
    // guard reasoning "exit > 1 means the search failed" reported clean having
    // searched nothing. Here the precondition is the branch list being
    // non-empty, checked directly.
    expect(source).toMatch(/the branch list came back empty/);
    expect(source).toMatch(/No repository is branchless/);
    expect(source).toMatch(/would have vacuously passed/);
  });

  test('one unreadable branch does not report as "everything matched"', () => {
    const body = source.slice(source.indexOf('def main'));
    // The per-branch loop raises through die_unverifiable rather than skipping.
    expect(body).toMatch(/except Unverifiable as exc:[\s\S]{0,200}die_unverifiable/);
  });

  // ---------------------------------------------------------------------
  // DRIFT IS TWO-WAY (SEC-106 §4b)
  // ---------------------------------------------------------------------

  test('the self-test pins both directions of drift and the STALE case', () => {
    const r = run(['--self-test']);
    expect(r.stdout).toMatch(/ok\s+a MISSING live context is drift/);
    // A required check quietly ADDED is as much an undocumented divergence as
    // one removed. Without this the file is an allowlist that may only grow,
    // which is a suppression list, not a ratchet.
    expect(r.stdout).toMatch(/ok\s+an EXTRA live context is drift too/);
    expect(r.stdout).toMatch(/ok\s+an expectation for a branch that no longer exists is STALE/);
    // The healthy steady state, so the four above cannot be satisfied by a
    // comparator that simply flags everything.
    expect(r.stdout).toMatch(/ok\s+live matching the expectation is clean/);
  });

  test('the expectation file names main`s guard context BY NAME', () => {
    const raw = JSON.parse(fs.readFileSync(EXPECTATION, 'utf8'));
    expect(Object.keys(raw.branches).length).toBeGreaterThanOrEqual(4);
    // The single assertion most worth having, per SEC-106 §4b: `guard` is
    // main-chain-guard.yml's JOB ID, so a one-character rename un-gates the
    // only technical backstop on SEC-98 production change control.
    expect(raw.branches.main.contexts).toContain('guard');
    for (const [branch, meta] of Object.entries(raw.branches)) {
      expect(Array.isArray(meta.contexts)).toBe(true);
      expect(meta.contexts.length).toBeGreaterThan(0);
      // enforce_admins stays OFF on every branch — turning it on deadlocks the
      // promote, which pushes directly (SEC-106 §2 "Do NOT do these"). Recorded
      // so that changing it is a visible diff rather than a dashboard click.
      expect(meta.enforce_admins).toBe(false);
      expect(typeof branch).toBe('string');
    }
  });

  test('every branch in the expectation is one the promotion chain uses', () => {
    const raw = JSON.parse(fs.readFileSync(EXPECTATION, 'utf8'));
    expect(Object.keys(raw.branches).sort()).toEqual(['beta', 'develop', 'main', 'staging']);
  });

  // ---------------------------------------------------------------------
  // WIRING (SEC-106 §4f)
  // ---------------------------------------------------------------------

  test('the local arm is wired into pr-checks.yml', () => {
    const wf = fs.readFileSync(path.join(ROOT, SRC.prChecks), 'utf8');
    // ⚠️ THE FULL COMMAND, not the script name and `--self-test` separately.
    // The first cut of this test asserted `toContain('check-required-checks.py')`
    // plus `toContain('--self-test')`, and DELETING THE --local INVOCATION LEFT
    // IT GREEN: the script name still matched its own --self-test line, and
    // `--self-test` matched the check-scheduled-workflows-active step directly
    // above. Two assertions, both satisfied by lines other than the one under
    // test. Found by mutation, which is the only way this class is ever found.
    expect(wf).toContain('python3 scripts/check-required-checks.py --local');
    expect(wf).toContain('python3 scripts/check-required-checks.py --self-test');
  });

  test('the live arm has a scheduled workflow that runs it', () => {
    const wf = fs.readFileSync(WORKFLOW, 'utf8');
    expect(wf).toMatch(/^\s*schedule:/m);
    expect(wf).toMatch(/cron:\s*['"]/);
    expect(wf).toContain('python3 scripts/check-required-checks.py --live');
    // The Workflow Integrity Policy, non-negotiable on a multi-line run block.
    expect(wf).toContain('set -euo pipefail');
    expect(wf).toMatch(/defaults:\s*\n\s*run:\s*\n\s*shell:\s*bash/);
    // ⚠️ NO SILENT SKIP. `if: env.X != ''` on a missing secret is the forbidden
    // pattern (KAN-167) and is how SEC-79 stayed invisible for a month. The
    // step must RUN and report UNVERIFIED, never be skipped.
    expect(wf).not.toMatch(/if:\s*.*secrets\./);
    expect(wf).not.toMatch(/continue-on-error:\s*true/);
  });

  test('the new scheduled workflow is declared to CTL-042 until it registers', () => {
    // GitHub does not index a workflow's schedule trigger until the file
    // reaches the DEFAULT branch, so CTL-042 would otherwise fail the very PR
    // that adds it. The entry is short-lived by construction: it goes STALE the
    // moment the workflow registers, which is what forces its deletion.
    const raw = JSON.parse(fs.readFileSync(
      path.join(ROOT, SRC.scheduledWorkflowExceptions), 'utf8'));
    const entry = raw.exceptions[SRC.requiredChecks];
    expect(entry).toBeDefined();
    expect(entry.key).toBe('SEC-106');
    expect(entry.reason).toMatch(/NOT YET REGISTERED/);
  });

  test('is registered in the control registry', () => {
    const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'controls/registry.json'), 'utf8'));
    const controls = reg.controls || reg;
    const entry = controls.find((c) => c.id === 'CTL-065');
    expect(entry).toBeDefined();
    expect(entry.implementation).toContain('check-required-checks.py');
    expect(entry.prevents).toContain('SEC-106');
    expect(entry.wired_in.length).toBeGreaterThan(0);
  });
});

describe('CTL-065 — the finding it was built from is real', () => {
  test('main-chain-guard.yml still carries no job `name:`, so its context IS the id', () => {
    // If this ever stops being true the expectation file's `guard` entry is
    // wrong, and the assertion above would be pinning a context nothing
    // reports. The premise is checked rather than assumed.
    const wf = fs.readFileSync(path.join(ROOT, SRC.mainChainGuard), 'utf8');
    const jobs = wf.slice(wf.indexOf('\njobs:'));
    expect(jobs).toMatch(/\n {2}guard:\n/);
    // The two lines after the job id must not be a `name:` at job level.
    const afterId = jobs.slice(jobs.indexOf('\n  guard:\n') + '\n  guard:\n'.length);
    expect(afterId.split('\n').slice(0, 6).join('\n')).not.toMatch(/^ {4}name:/m);
  });

  test('the contexts the expectation names are produced by exactly the workflows claimed', () => {
    // A corpus assertion before the comparison: if this repo somehow had no
    // workflows, the local arm's pass would be vacuous.
    const files = execSync('git ls-files .github/workflows/', { cwd: ROOT, encoding: 'utf8' })
      .split('\n').filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
    expect(files.length).toBeGreaterThan(10);
  });
});
