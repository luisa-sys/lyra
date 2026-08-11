/**
 * CTL-048 — tests for scripts/check-live-schema-parity.py.
 *
 * WHAT THIS FILE CAN AND CANNOT PROVE
 * -----------------------------------
 * The subject talks to three live databases, and CI here has no credentials.
 * So this exercises the two things that do not need them, and says plainly that
 * it is not exercising the third:
 *
 *   1. the comparators (via `--self-test`, which is the subject's own fixture
 *      suite and is asserted to run a FLOOR of cases, so deleting fixtures
 *      cannot quietly shrink it);
 *   2. the fail-closed path — no credentials must exit NON-ZERO.
 *
 * It cannot prove the live comparison is correct against real data. That is
 * asserted by the job in promote-to-staging.yml, and its self-test runs on
 * every PR so a rotted comparator fails before a promotion depends on it.
 *
 * ⚠️ THE FLOOR IS THE POINT. `expect(stdout).toMatch(/(\d+)\/(\d+) passed/)`
 * moves its denominator with its numerator, so it detects a fixture that FAILS
 * and never one that is DELETED. The same lesson as SELF_TEST_FLOORS in
 * qa-sweep-preflight.test.js, where cutting a self-test from 26 checks to 1
 * left jest fully green.
 */
const { execFileSync, spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { SRC } = JSON.parse(
  require('node:fs').readFileSync(path.join(ROOT, 'tests/support/source-paths.json'), 'utf-8'),
);
const SCRIPT = path.join(ROOT, SRC.checkLiveSchemaParity);

/** Committed MINIMUM number of self-test fixtures. May be raised, never lowered. */
const SELF_TEST_FLOOR = 6;

/** Run with an explicitly constructed env so an ambient credential cannot leak in. */
function run(args, extraEnv = {}) {
  const env = Object.assign(
    { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'en_GB.UTF-8' },
    extraEnv,
  );
  return spawnSync('python3', [SCRIPT, ...args], { encoding: 'utf-8', cwd: ROOT, env });
}

describe('CTL-048 — live schema parity', () => {
  test('the checker self-test passes, and runs at least its committed floor', () => {
    const r = run(['--self-test']);
    expect(r.status).toBe(0);

    const m = /live-schema-parity self-test: (\d+)\/(\d+) passed/.exec(r.stdout);
    expect(`self-test line present: ${Boolean(m)}`).toBe('self-test line present: true');

    const [, passed, total] = m.map(Number);
    expect(`${passed}/${total}`).toBe(`${total}/${total}`);
    expect(total).toBeGreaterThanOrEqual(SELF_TEST_FLOOR);
  });

  test('the self-test covers drift in BOTH directions', () => {
    // dev-is-behind is a real case here (BUGS-62 `claimed_at`), so a checker
    // that only looked for prod-is-missing would report clean on it.
    const r = run(['--self-test']);
    expect(r.stdout).toMatch(/reverse drift \(dev behind\) is detected/);
    expect(r.stdout).toMatch(/live drift is detected/);
  });

  test('⚠️ FAILS CLOSED: no credentials exits non-zero, it does not skip', () => {
    // The whole reason this control is trustworthy. A step that passes when it
    // could not run produces a green tick over an unchecked estate — the
    // silent-skip pattern the Workflow & Backup Integrity Policy forbids.
    const r = run([]);
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/no credentials for/);
    expect(r.stdout + r.stderr).toMatch(/must not report success/);
  });

  test('it names WHICH credential is missing, per environment', () => {
    // A failure that does not say what to set is a failure someone disables.
    const out = run([]).stdout;
    for (const v of [
      'NEXT_PUBLIC_SUPABASE_URL',
      'STAGING_SUPABASE_SERVICE_ROLE_KEY',
      'PROD_SUPABASE_URL',
    ]) {
      expect(out).toContain(v);
    }
  });

  test('it is registered as a control and wired into the promotion chain', () => {
    // CTL-041's lesson generalised: a control the registry does not know about
    // is one nobody maintains, and a registered control nothing invokes is a
    // claim rather than a gate.
    const registry = JSON.parse(
      require('node:fs').readFileSync(path.join(ROOT, 'controls/registry.json'), 'utf-8'),
    );
    const entry = registry.controls.find((c) => c.id === 'CTL-048');
    expect(entry).toBeDefined();
    expect(entry.implementation).toBe(SRC.checkLiveSchemaParity);
    expect(entry.wired_in.some((w) => w.endsWith('promote-to-staging.yml'))).toBe(true);

    for (const wf of entry.wired_in) {
      const yml = require('node:fs').readFileSync(path.join(ROOT, wf), 'utf-8');
      expect(`${wf} invokes it: ${yml.includes(entry.implementation)}`).toBe(
        `${wf} invokes it: true`,
      );
    }
  });

  test('the promotion is BLOCKED by it, not merely annotated by it', () => {
    // A gate that runs alongside the merge instead of before it is decoration.
    const registry = JSON.parse(
      require('node:fs').readFileSync(path.join(ROOT, 'controls/registry.json'), 'utf-8'),
    );
    const wf = registry.controls
      .find((c) => c.id === 'CTL-048')
      .wired_in.find((w) => w.endsWith('promote-to-staging.yml'));
    const yml = require('node:fs').readFileSync(path.join(ROOT, wf), 'utf-8');
    expect(yml).toMatch(/needs:\s*\[verify-source, signup-gate, schema-parity\]/);
    // And it must not carry continue-on-error, which would make the `needs`
    // edge satisfiable by a failing job.
    const jobBlock = yml.slice(yml.indexOf('  schema-parity:'), yml.indexOf('  merge-and-deploy:'));
    expect(jobBlock).not.toMatch(/continue-on-error/);
  });

  test('git is not required — the subject reads files and HTTP only', () => {
    // Guards the harness itself: the self-test must not depend on repo state,
    // or it would pass or fail depending on where it was run from.
    expect(() => execFileSync('python3', [SCRIPT, '--self-test'], { cwd: '/tmp', stdio: 'pipe' }))
      .not.toThrow();
  });
});
