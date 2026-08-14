/**
 * CTL-057 — tests for scripts/check-release-tagged.py (BUGS-97).
 *
 * WHAT THIS FILE CAN AND CANNOT PROVE
 * -----------------------------------
 * The subject reads git. That is fully exercisable here, so unlike CTL-048/049
 * there is no credential-shaped hole — these tests drive the REAL script as a
 * subprocess against throwaway git repos (CTL-038: never a reimplementation).
 *
 * ⚠️ THE FLOOR IS THE POINT. `--self-test` reports `N/M passed`, and a matcher
 * that reads both numbers moves its denominator with its numerator — it detects
 * a fixture that FAILS and never one that is DELETED. Same lesson as
 * SELF_TEST_FLOORS in qa-sweep-preflight.test.js, where cutting a self-test from
 * 26 checks to 1 left jest fully green.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { SRC } = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'tests/support/source-paths.json'), 'utf-8'),
);
const SCRIPT = path.join(ROOT, SRC.checkReleaseTagged);

/** Committed MINIMUM number of self-test fixtures. May be raised, never lowered. */
const SELF_TEST_FLOOR = 10;

function run(args, cwd = ROOT) {
  return spawnSync('python3', [SCRIPT, ...args], { encoding: 'utf-8', cwd });
}

/** A throwaway repo with one commit, optionally tagged. */
function makeRepo({ tagged, subject = 'Promote beta → production' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctl057-jest-'));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@t',
  };
  const git = (...a) => spawnSync('git', a, { cwd: dir, env, encoding: 'utf-8' });
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'f'), 'x');
  git('add', 'f');
  git('commit', '-qm', subject);
  if (tagged) git('tag', 'v9.9.9');
  return dir;
}

describe('CTL-057 — a production release carries a tag', () => {
  test('the self-test passes, and runs at least its committed floor', () => {
    const r = run(['--self-test']);
    expect(r.status).toBe(0);
    const m = /release-tagged self-test: (\d+)\/(\d+) passed/.exec(r.stdout);
    expect(`self-test line present: ${Boolean(m)}`).toBe('self-test line present: true');
    const [, passed, total] = m.map(Number);
    expect(`${passed}/${total}`).toBe(`${total}/${total}`);
    expect(total).toBeGreaterThanOrEqual(SELF_TEST_FLOOR);
  });

  test('⚠️ an OLD untagged release FAILS — the defect BUGS-97 ships', () => {
    // The load-bearing case. Seven of the last fourteen production releases
    // were in exactly this state on 2026-08-14 with nothing red.
    const dir = makeRepo({ tagged: false });
    const r = run(['--ref', 'main', '--grace-minutes', '0'], dir);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/UNTAGGED/);
  });

  test('a tagged release passes even at grace 0 — the gate is not always-fire', () => {
    // Without this, "an untagged head fails" would also be satisfied by a
    // checker that fails unconditionally, and the suite would prove nothing.
    const dir = makeRepo({ tagged: true });
    const r = run(['--ref', 'main', '--grace-minutes', '0'], dir);
    expect(r.status).toBe(0);
  });

  test('a JUST-MERGED untagged head warns rather than failing', () => {
    // A promote merges main and tags it minutes later. Failing inside that
    // window would make the control fire on every healthy release, which is
    // how a gate gets switched off.
    const dir = makeRepo({ tagged: false });
    const r = run(['--ref', 'main'], dir);
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/grace window/);
  });

  test('the grace window is a stated decision, not a silent skip', () => {
    // The Workflow & Backup Integrity Policy forbids a step that quietly
    // passes. "Untagged but young" is a decision and must say so out loud.
    const dir = makeRepo({ tagged: false });
    const out = run(['--ref', 'main'], dir);
    expect(out.stdout + out.stderr).toMatch(/::warning::/);
    expect(out.stdout + out.stderr).toMatch(/UNTAGGED/);
  });

  test('⚠️ FAILS CLOSED: an unresolvable ref exits 2, it does not report clean', () => {
    // Regression pin for a REAL bug in the first draft: `git rev-parse bad-ref`
    // exits non-zero but ECHOES THE REF NAME, so a truthiness check accepted
    // "no-such-branch" as a SHA, found no tags on it, and reported a missing
    // branch as an untagged release — a finding invented out of a typo.
    const dir = makeRepo({ tagged: true });
    const r = run(['--ref', 'definitely-not-a-branch'], dir);
    expect(r.status).toBe(2);
    expect(r.stdout + r.stderr).toMatch(/cannot resolve/);
  });

  test('the failure names BOTH the cause and the remedy', () => {
    // A failure that does not say what to do is a failure someone mutes —
    // and this one fires on a healthy `main`, so it MUST say "not a bad deploy".
    const dir = makeRepo({ tagged: false });
    const out = run(['--ref', 'main', '--grace-minutes', '0'], dir).stdout;
    expect(out).toMatch(/BUGS-97/);
    expect(out).toMatch(/re-run promote-to-production/);
  });

  test('--report refuses an EMPTY corpus rather than printing "0 untagged"', () => {
    // Catalogue failure mode 4: a conclusion drawn from an empty list. If the
    // promote subject line ever changes, this must fail rather than report a
    // spotless release history.
    const dir = makeRepo({ tagged: false, subject: 'chore: not a promote' });
    const r = run(['--ref', 'main', '--report'], dir);
    expect(r.status).toBe(2);
  });

  test('it is registered as a control and wired into a workflow that invokes it', () => {
    // CTL-041's lesson: a control the registry does not know about is one
    // nobody maintains, and a registered control nothing invokes is a claim.
    const registry = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'controls/registry.json'), 'utf-8'),
    );
    const entry = registry.controls.find((c) => c.id === 'CTL-057');
    expect(entry).toBeDefined();
    expect(entry.implementation).toBe(SRC.checkReleaseTagged);
    expect(entry.wired_in.length).toBeGreaterThan(0);
    for (const wf of entry.wired_in) {
      const yml = fs.readFileSync(path.join(ROOT, wf), 'utf-8');
      expect(`${wf} invokes it: ${yml.includes(entry.implementation)}`).toBe(
        `${wf} invokes it: true`,
      );
    }
  });

  test('⚠️ the workflow fetches tags — a shallow clone would make it fire on everything', () => {
    // gotcha #11: actions/checkout defaults to depth 1 and omits tags. Without
    // fetch-depth: 0 this control would find no tag on ANY commit and report
    // every release as untagged. A gate that fires always is as useless as one
    // that never fires, and louder.
    const yml = fs.readFileSync(
      path.join(ROOT, SRC.releaseIntegrity),
      'utf-8',
    );
    expect(yml).toMatch(/fetch-depth:\s*0/);
    expect(yml).toMatch(/fetch-tags:\s*true/);
  });

  test('the workflow runs AFTER a production promote, not only on a schedule', () => {
    // The whole point is catching a promote that finished green while its tag
    // job was skipped. A daily-only check would leave that live for up to a day.
    // `workflow_run` must fire on completion regardless of conclusion, because
    // the case being detected is a promote that reported SUCCESS.
    const yml = fs.readFileSync(
      path.join(ROOT, SRC.releaseIntegrity),
      'utf-8',
    );
    expect(yml).toMatch(/workflow_run:/);
    expect(yml).toMatch(/workflows:\s*\['Promote to Production'\]/);
    expect(yml).toMatch(/types:\s*\[completed\]/);
  });

  test('the workflow_run trigger names a workflow that actually exists', () => {
    // A `workflows:` entry is matched by NAME. A typo, or a rename of the
    // promote workflow, leaves this trigger matching nothing — and a trigger
    // that never fires looks identical to one that never had anything to report.
    const yml = fs.readFileSync(
      path.join(ROOT, SRC.releaseIntegrity),
      'utf-8',
    );
    const declared = /workflows:\s*\['([^']+)'\]/.exec(yml)[1];
    const promote = fs.readFileSync(
      path.join(ROOT, SRC.promoteToProduction),
      'utf-8',
    );
    const actual = /^name:\s*(.+)$/m.exec(promote)[1].trim();
    expect(`trigger names: ${declared}`).toBe(`trigger names: ${actual}`);
  });
});
