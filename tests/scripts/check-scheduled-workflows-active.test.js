/**
 * CTL-042 — scheduled workflows must actually be ACTIVE.
 *
 * The control's whole premise is that a DISABLED workflow has a perfect file on
 * disk, so these tests are careful to exercise the two halves that can rot
 * independently: the PARSING (which workflows claim a schedule) and the
 * POLICY (what happens when one of them is not active).
 *
 * The GitHub API is not reachable from a unit test, so the parsing half is
 * covered through the script's own --self-test fixtures, and the policy half by
 * asserting the source contract. That is a real limitation and is stated rather
 * than papered over: the end-to-end path is exercised for real on every CI run
 * of pr-checks.yml, where the token exists.
 */
const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../');
const { SRC } = require('../support/source-paths.json');
// Both taken from the manifest rather than written out — the KAN-414 F4
// ratchet counts raw path literals in tests, and a test about a guard is
// exactly the kind that hardcodes its subject's path and then breaks on a move.
const SCRIPT = path.join(ROOT, SRC.checkScheduledWorkflowsActive);
const EXCEPTIONS = path.join(ROOT, SRC.scheduledWorkflowExceptions);

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

describe('check-scheduled-workflows-active.py (CTL-042)', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');

  test('the script exists and is executable', () => {
    expect(fs.existsSync(SCRIPT)).toBe(true);
    expect(fs.statSync(SCRIPT).mode & 0o111).toBeTruthy();
  });

  test('self-test passes in full, and runs at least its committed floor', () => {
    const r = run(['--self-test']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/self-test: \d+\/\d+ passed/);

    // ⚠️ THE FLOOR IS NET-NEW (BUGS-102), AND THE REGEX ABOVE IS WHY.
    // `\d+\/\d+ passed` moves its denominator with its numerator, so it detects
    // a fixture that FAILS and never one that is DELETED — the whole corpus
    // could be cut to a single case and this stayed green. That is catalogue
    // failure mode 8 (a number nothing enforces), and it mattered here: the six
    // classification fixtures BUGS-102 added are the only thing standing
    // between this control and the deadlock returning, and nothing would have
    // noticed their removal.
    //
    // Raise it with any net-new case; never lower it to make a red build green.
    const [, passed, total] = /self-test: (\d+)\/(\d+) passed/.exec(r.stdout).map(Number);
    expect(`${passed}/${total}`).toBe(`${total}/${total}`);
    expect(total).toBeGreaterThanOrEqual(13);
  });

  test('a commented-out cron is not treated as a live schedule', () => {
    // backup-complete.yml ships its cadence commented until the backup is
    // commissioned, so reading that as scheduled would raise a finding nobody
    // can ever resolve — and an unresolvable finding is how a gate gets waved
    // through. Pinned here as well as in --self-test because it is the one
    // parsing decision that produces a PERMANENT false positive if wrong.
    const r = run(['--self-test']);
    expect(r.stdout).toMatch(/ok\s+commented-out cron is NOT a schedule/);
  });

  test('it fails CLOSED when the truth cannot be established', () => {
    // The failure this control guards against is "looks fine but is not
    // running". If the check itself cannot run, reporting a pass would be the
    // same class of lie.
    expect(source).toMatch(/def die_unverifiable/);
    expect(source).toMatch(/sys\.exit\(2\)/);
    expect(source).toMatch(/refusing to pass vacuously/);
    // An empty API response must be unverifiable, never "nothing wrong".
    expect(source).toMatch(/the GitHub API returned no workflows/);
  });

  test('it refuses to pass when the scan finds no scheduled workflows at all', () => {
    // A scan that silently matches nothing is the SEC-79 shape this whole
    // control exists to close, so the script must not accept its own zero.
    expect(source).toMatch(/no workflow declares a cron schedule/);
    expect(source).toMatch(/not credible for this repo/);
  });

  test('an exception requires BOTH a Jira key and a reason', () => {
    expect(source).toMatch(/has no valid Jira key/);
    expect(source).toMatch(/has a key but no reason/);
    expect(source).toMatch(/A bare marker is itself a failure/);
  });

  test('a STALE exception — for a workflow that is active again — is an error', () => {
    // Without this, the list only ever grows, and a list that only grows is a
    // suppression list. Note it returns 1 even in warn mode, deliberately:
    // a stale entry is unambiguous and needs no founder decision.
    expect(source).toMatch(/STALE exception/);
    expect(source).toMatch(/stale_exceptions/);
  });

  test('the exceptions file is valid JSON with an exceptions object', () => {
    const raw = JSON.parse(fs.readFileSync(EXCEPTIONS, 'utf8'));
    expect(typeof raw.exceptions).toBe('object');
    for (const [wf, meta] of Object.entries(raw.exceptions)) {
      expect(typeof wf).toBe('string');
      expect(meta.key).toMatch(/^[A-Z][A-Z0-9]+-[0-9]+$/);
      expect(String(meta.reason || '').trim().length).toBeGreaterThan(0);
    }
  });

  test('every workflow named in the exceptions file actually exists', () => {
    // An exception for a workflow that has been deleted is dead weight that
    // reads as active cover.
    const raw = JSON.parse(fs.readFileSync(EXCEPTIONS, 'utf8'));
    for (const wf of Object.keys(raw.exceptions)) {
      expect(fs.existsSync(path.join(ROOT, wf))).toBe(true);
    }
  });

  test('it is wired into pr-checks.yml, with the actions:read it needs', () => {
    const wf = fs.readFileSync(path.join(ROOT, SRC.prChecks), 'utf8');
    expect(wf).toContain('check-scheduled-workflows-active.py');
    // Reading workflow STATE needs actions:read. Without it the gh call fails,
    // the script exits 2, and the step goes red — loudly, not silently, which
    // is the intended direction. Asserted anyway so the permission is not
    // dropped by a future least-privilege sweep without someone noticing.
    expect(wf).toMatch(/actions:\s*read/);
    expect(wf).toMatch(/GH_TOKEN:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/);
  });

  test('it ships warn-first, with an explicit escalation switch', () => {
    // Four workflows are inactive pending a founder decision. Blocking now
    // would fail every unrelated PR on something nobody but the founder can
    // clear, and that is how gates get switched off for good.
    expect(source).toMatch(/SCHEDULED_WORKFLOW_GATE_ENFORCE/);
    expect(source).toMatch(/--enforce/);
  });

  test('is registered in the control registry', () => {
    const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'controls/registry.json'), 'utf8'));
    const controls = reg.controls || reg;
    const entry = controls.find((c) => c.id === 'CTL-042');
    expect(entry).toBeDefined();
    expect(entry.implementation).toContain('check-scheduled-workflows-active.py');
  });
});

describe('CTL-042 — the finding it was built from is real', () => {
  test('the repo has scheduled workflows to check', () => {
    const out = execSync('git ls-files .github/workflows/', { cwd: ROOT, encoding: 'utf8' });
    const files = out.split('\n').filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
    expect(files.length).toBeGreaterThan(10);
    const scheduled = files.filter((f) => {
      const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
      const live = text.split('\n').map((l) => l.replace(/#.*$/, '')).join('\n');
      return /^\s*schedule:/m.test(live) && /cron:\s*['"]/.test(live);
    });
    // If this ever reaches zero the control above would pass vacuously, so the
    // premise is asserted rather than assumed.
    expect(scheduled.length).toBeGreaterThan(5);
  });
});
