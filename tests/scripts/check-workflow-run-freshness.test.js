/**
 * CTL-072 (SEC-106 §3 item 3 / §4c) — a cron is a request, not a fact.
 *
 * `db-invariants.yml` has said "daily" since the day it was written and nothing
 * has ever asserted that it ran. CTL-042 answers the adjacent question — is the
 * workflow `disabled_manually`? — and is correctly green for every state in
 * which a workflow is enabled and silent: a schedule suspended after 60 days of
 * repository inactivity, a cron that parses and never matches, a `schedule`
 * trigger never registered on the default branch.
 *
 * WHAT IS AND IS NOT COVERED HERE, stated rather than implied (SEC-106 §4's own
 * instruction — recording a gap is a finding, hiding it is a regression):
 *
 *   COVERED  the judgement. `classify`, `stale_entries` and `load_config` are
 *            pure and are exercised through the script's own --self-test
 *            fixtures, driven here as a subprocess. The freshness verdict is
 *            decided from a fixture run-list with a controlled `now`, per §4c
 *            ("drive it from a fixture run-list with a stale timestamp, not
 *            from the live API").
 *
 *   COVERED  the config's two-way ratchet, end to end against the real repo:
 *            every watched workflow file must exist.
 *
 *   NOT      the live Actions API path. It needs a real token against real run
 *            history, which no unit test has. It is exercised only by the
 *            scheduled `freshness` job in required-checks.yml — the same stated
 *            gap check-required-checks.py carries for its --live arm.
 *
 *   NOT      whether a successful run did anything useful. A workflow whose
 *            every step is a no-op still concludes `success`. Different class,
 *            different control (CTL-062, and the workflow-integrity guards).
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../');
const { SRC } = require('../support/source-paths.json');
// Via the manifest, never as raw literals — the KAN-414 F4 ratchet counts raw
// path literals under tests/, and a test about a guard is precisely the kind
// that hardcodes its subject's path and then breaks silently on a move
// (gotcha #31). Both keys are seeded in tests/support/source-path-seeds.ts.
const SCRIPT = path.join(ROOT, SRC.checkWorkflowRunFreshness);
const CONFIG = path.join(ROOT, SRC.workflowFreshness);
const SCHEDULED_WORKFLOW = path.join(ROOT, SRC.requiredChecks);
const PR_CHECKS = path.join(ROOT, SRC.prChecks);

function run(args = []) {
  try {
    return {
      exitCode: 0,
      stdout: execFileSync('python3', [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' }),
    };
  } catch (err) {
    return { exitCode: err.status ?? 1, stdout: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

describe('check-workflow-run-freshness.py (CTL-072)', () => {
  test('the script exists and is executable', () => {
    expect(fs.existsSync(SCRIPT)).toBe(true);
    expect(fs.statSync(SCRIPT).mode & 0o111).toBeTruthy();
  });

  describe('the self-test', () => {
    const result = run(['--self-test']);

    test('passes', () => {
      expect(result.stdout).toContain('self-test:');
      expect(result.exitCode).toBe(0);
    });

    // ⚠️ A FLOOR, not "N/N passed". BUGS-102 / catalogue failure mode 8: an
    // assertion whose denominator moves with its numerator detects a fixture
    // that FAILS and never one that is DELETED — the corpus could be cut to a
    // single case and stay green. Raise this number when cases are added.
    test('ships at least 24 cases — a floor, so the corpus cannot be gutted', () => {
      const m = result.stdout.match(/self-test:\s+(\d+)\/(\d+)\s+passed/);
      expect(m).not.toBeNull();
      expect(Number(m[1])).toBe(Number(m[2]));
      expect(Number(m[1])).toBeGreaterThanOrEqual(24);
    });

    // SEC-140: eight self-test cases in check-npm-audit-gate.py were appended
    // AFTER its `if failures:` check, so every one of them was a no-op and
    // three separate mutations printed "Self-test passed" while the case count
    // went UP. Assert WHERE the verdict is read, not merely that cases append.
    test('the verdict is read after every case is appended', () => {
      const src = fs.readFileSync(SCRIPT, 'utf8');
      const verdict = src.indexOf('failed = [n for n, ok in cases if not ok]');
      expect(verdict).toBeGreaterThan(-1);
      const after = src.slice(verdict);
      expect(after).not.toMatch(/^\s*check\(/m);
      expect(after).not.toMatch(/cases\.append/);
    });
  });

  // -----------------------------------------------------------------------
  // §4c — the needs:-skip trap. The single most important behaviour here.
  // -----------------------------------------------------------------------
  describe('GitHub-successful-but-not-run conclusions', () => {
    const out = run(['--self-test']).stdout;

    // GitHub's successful-status set is {success, skipped, neutral}. A
    // freshness check keyed on "a run exists" is satisfied by all three, which
    // is most of the promote-reports-success cluster in SEC-106 §1.
    test.each(['SKIPPED', 'CANCELLED', 'NEUTRAL'])(
      'a run concluding %s inside the window is not treated as fresh',
      (concl) => {
        expect(out).toContain(`ok   a run concluding ${concl} inside the window is NOT fresh`);
      },
    );

    test('an in-flight run (conclusion null) is not fresh', () => {
      expect(out).toContain('ok   a run still in flight (conclusion null) is NOT fresh');
    });

    test('a conclusion GitHub has not invented yet is not fresh', () => {
      expect(out).toContain('ok   a conclusion GitHub has not invented yet is NOT fresh');
    });

    test('the SKIPPED finding names the trap rather than saying only "not success"', () => {
      expect(out).toContain(
        'ok   the SKIPPED finding names the needs:-skip trap rather than just',
      );
    });
  });

  // -----------------------------------------------------------------------
  // §4c — "inability to list runs is exit 2, not stale, and certainly not fresh"
  // -----------------------------------------------------------------------
  describe('the three-valued exit contract', () => {
    test('a missing config file is UNVERIFIED (exit 2), never a clean pass', () => {
      const r = run(['--self-test']);
      expect(r.stdout).toContain('ok   a missing config file is UNVERIFIED, not clean');
    });

    // CTL-059: db-invariants.yml raised every non-zero exit under a bare
    // `if: failure()`, so an HTTP 403 printed the divergence story and sent the
    // reader hunting an uncommitted migration on three separate days. The
    // could-not-measure wording must warn the reader OFF a finding that was
    // never observed, in language distinct from a measured one.
    test('the exit-2 wording is distinct from the exit-1 wording', () => {
      const src = fs.readFileSync(SCRIPT, 'utf8');
      expect(src).toContain('UNVERIFIED —');
      expect(src).toContain('Exit 2 means NOTHING WAS MEASURED');
      expect(src).toContain('do not conclude the workflow has');
      // ...and the measured path says the opposite, in its own words.
      expect(src).toContain('this was measured, not guessed');
    });

    // Gotcha #30: /usr/bin/grep --include returns 1, not 2, for a missing
    // search path, so a guard reasoning "exit > 1 means the search failed"
    // reported clean having searched nothing. Assert the PRECONDITION exists,
    // rather than inferring fail-closed from a status code.
    test('an empty workflow list is refused as a precondition, not read as "never ran"', () => {
      const src = fs.readFileSync(SCRIPT, 'utf8');
      expect(src).toContain('GitHub reported ZERO workflows for this repository');
      // The distinction that makes an empty run list meaningful at all.
      expect(src).toContain('An absent key is not an empty list');
    });
  });

  // -----------------------------------------------------------------------
  // The config, end to end against the real repository.
  // -----------------------------------------------------------------------
  // Named through the manifest rather than as a literal: the F4 ratchet is
  // shrink-only, and raising it to accommodate one describe() string is how a
  // ratchet decays into the suppression list it replaced.
  describe(SRC.workflowFreshness, () => {
    const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    const watched = Object.entries(cfg.watched || {});

    // Catalogue failure mode 4: test.each over an empty list registers ZERO
    // tests and an empty suite is green. Assert the corpus before iterating it.
    test('watches at least one workflow', () => {
      expect(watched.length).toBeGreaterThanOrEqual(1);
    });

    test.each(watched)('%s names a workflow file that exists', (name, meta) => {
      expect(fs.existsSync(path.join(ROOT, '.github', 'workflows', name))).toBe(true);
      expect(typeof meta.max_age_hours).toBe('number');
      expect(meta.max_age_hours).toBeGreaterThan(0);
      expect(String(meta.reason || '').length).toBeGreaterThan(20);
    });

    // SEC-106 §3 item 3 names this workflow specifically. If it ever leaves the
    // config, the leg of the ticket this control was built for is gone.
    test('db-invariants.yml is watched — the workflow the ticket names', () => {
      expect(Object.keys(cfg.watched)).toContain(SRC.dbInvariants.split('/').pop());
    });

    // §4f says to point this at required-checks.yml too. It is deliberately NOT
    // watched, because that workflow exits 2 UNVERIFIED on every run until
    // BRANCH_PROTECTION_READ_TOKEN exists — watching it would install a
    // permanent red, which is catalogue failure mode 7 (a red you have learned
    // to expect is a control you have switched off). The decision is asserted
    // so that adding it later is a deliberate act with a test to update, and
    // the reason is asserted so a reader finds it without archaeology.
    test('required-checks.yml is deliberately not watched, and says why', () => {
      const own = SRC.requiredChecks.split('/').pop();
      expect(Object.keys(cfg.watched)).not.toContain(own);
      expect(cfg.$why_not_required_checks_yml).toContain('BRANCH_PROTECTION_READ_TOKEN');
    });
  });

  // -----------------------------------------------------------------------
  // Wiring. A control nothing invokes is the SEC-79 shape (CTL-026).
  // -----------------------------------------------------------------------
  describe('wiring', () => {
    const scheduled = fs.readFileSync(SCHEDULED_WORKFLOW, 'utf8');

    test('the live arm runs on the daily schedule', () => {
      expect(scheduled).toContain('check-workflow-run-freshness.py');
      expect(scheduled).toMatch(/cron:\s*'[^']+'/);
    });

    test('the scheduled workflow grants actions: read', () => {
      expect(scheduled).toMatch(/^\s+actions:\s+read\s*$/m);
    });

    // THE ASSERTION THIS CONTROL WOULD BE EMBARRASSED TO LACK. Chaining the
    // freshness job behind `drift` — which is EXPECTED to exit 2 until a token
    // exists — would make it report SKIPPED every day, i.e. the exact trap the
    // control exists to detect, in the workflow that hosts it.
    test('the freshness job does not depend on the drift job', () => {
      const job = scheduled.slice(scheduled.indexOf('\n  freshness:'));
      expect(job.length).toBeGreaterThan(100);
      expect(job).not.toMatch(/^\s+needs:/m);
    });

    test('the self-test is invoked from the PR gate', () => {
      expect(fs.readFileSync(PR_CHECKS, 'utf8')).toContain(
        'check-workflow-run-freshness.py --self-test',
      );
    });
  });
});
