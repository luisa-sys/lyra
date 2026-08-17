/**
 * CTL-071 / SEC-151 — the control that regenerates a schema snapshot from its
 * own database and diffs it, rather than asking whether some enumerated list of
 * properties still holds.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Two snapshot controls already ran and both were green on 2026-08-16 while all
 * three committed snapshots were simultaneously wrong about their own
 * databases. CTL-036 diffs the snapshots against EACH OTHER, so uniform
 * staleness is zero drift by construction. CTL-048 asks the databases but
 * compares column SETS, so a column with the wrong nullability is still in the
 * set, an enum member is not a column, and view updatability is not a column.
 *
 * This file guards the guard. It reaches the REAL script by subprocess rather
 * than reimplementing any comparison logic (CTL-038): a private copy of
 * `normalise` would keep agreeing with itself while the shipped one drifted,
 * and "the test reimplements its subject" is the first entry in CLAUDE.md's
 * catalogue for a reason.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not regenerate anything — no CLI, no token in a unit run. The live
 * half is asserted daily by db-invariants.yml. What is testable here is the
 * comparison, the normalisation boundary, and the fail-closed behaviour, and
 * that is where the defects live.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { SRC } = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../support/source-paths.json'), 'utf-8'),
);

const SCRIPT = SRC.checkSnapshotRegeneration;
const DAILY = SRC.dbInvariants;
const PR_CHECKS = SRC.prChecks;

/**
 * Run the real script. Returns {code, out} rather than throwing, because the
 * non-zero exits ARE the behaviour under test.
 */
function run(args, env = {}) {
  try {
    const out = execFileSync('python3', [SCRIPT, ...args], {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

/**
 * The script's own fixture count. It is REPORTED by counting assertions as they
 * evaluate rather than declared as a constant, so this floor only has to move
 * when cases are added. CTL-049 carried a hand-typed count that read 29 while
 * 33 assertions ran; that is catalogue failure mode 8 inside a self-test.
 */
const SELF_TEST_FLOOR = 18;

describe('CTL-071 — snapshot regeneration parity', () => {
  test('the self-test passes and has not silently shrunk', () => {
    const { code, out } = run(['--self-test']);
    expect(`exit ${code}: ${out.trim()}`).toContain('Self-test passed');
    expect(code).toBe(0);

    const cases = Number(/Self-test passed \((\d+) cases\)/.exec(out)?.[1] ?? 0);
    expect(cases).toBeGreaterThanOrEqual(SELF_TEST_FLOOR);
  });

  test('it reports UNVERIFIED (exit 2), not clean, when it cannot generate', () => {
    // The SEC-136 failure mode. "Every snapshot matches" and "I could not
    // look" are different facts, and a control that conflates them produces a
    // green tick for a question it never asked. Exit 2 is deliberately
    // distinct from exit 1, and the daily workflow branches on that.
    const { code, out } = run([], { SUPABASE_ACCESS_TOKEN: '' });
    expect(out).toContain('::error::');
    expect(out).toContain('SUPABASE_ACCESS_TOKEN is not set');
    expect(out).toContain('UNVERIFIED');
    expect(code).toBe(2);
  });

  test('exit 2 is reachable for a generation failure too, not only a missing token', () => {
    // A directory with no <env>.ts in it stands in for "the generation did not
    // produce anything usable". This must be exit 2 (could not look), never
    // exit 1 (the snapshot is wrong) — the mis-described 403 that sent a
    // reader hunting an uncommitted migration on 2026-08-14 was exactly this
    // conflation in the sibling control.
    const { code, out } = run(['--generated-dir', 'tests/support', '--env', 'dev']);
    expect(out).toContain('Failing closed (exit 2)');
    expect(code).toBe(2);
  });
});

describe('CTL-071 — the normalisation boundary is the whole design', () => {
  // Everything this control can miss, it misses because `normalise` collapsed
  // it. The self-test pins both directions with fixtures; these assert the
  // REASONING is recorded, because the next person to widen it needs to know
  // what it cost to make it this narrow.
  const src = fs.readFileSync(path.join(ROOT, SCRIPT), 'utf-8');

  test('it states which single class of difference it ignores', () => {
    expect(src).toContain('WHAT IT NORMALISES, AND WHY THAT IS EXACTLY ONE THING');
    expect(src).toContain('The stated gap:');
  });

  test('it records why a whole-file diff beats enumerating dimensions', () => {
    // The load-bearing argument. Someone will propose replacing this with
    // three targeted assertions on nullability, enums and views; the answer
    // is that those are not a category, they are the three that were found.
    expect(src).toContain('WHY A WHOLE-FILE DIFF RATHER THAN THREE NEW ASSERTIONS');
    expect(src).toContain('not a category');
  });

  test('it flags the unpinned generator as a cause of a red it can produce', () => {
    // gen-db-types.sh runs `npx --yes supabase`, unpinned and absent from
    // package.json. For a byte-level diff that is load-bearing: a CLI release
    // can redden all three environments with no schema change at all.
    expect(src).toContain('THE GENERATOR IS NOT PINNED');
    const genTypes = fs.readFileSync(path.join(ROOT, SRC.genDbTypes), 'utf-8');
    expect(genTypes).toContain('npx --yes supabase');
  });
});

describe('CTL-071 — is wired in, not merely written', () => {
  // SEC-79: health-check.yml and weekly-report.yml sat disabled for over a
  // month while still reporting green. A control that exists in the tree and
  // runs nowhere is indistinguishable from one that was never written.
  const daily = fs.readFileSync(path.join(ROOT, DAILY), 'utf-8');
  const prChecks = fs.readFileSync(path.join(ROOT, PR_CHECKS), 'utf-8');

  test('the daily workflow runs the LIVE check, not only the self-test', () => {
    // The distinction that matters: a job that only ever runs --self-test
    // proves the comparison works and asserts nothing about any database.
    const invocations = daily
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.includes(`python3 ${SCRIPT}`));
    expect(invocations.length).toBeGreaterThan(0);
    expect(invocations.some((l) => !l.includes('--self-test'))).toBe(true);
  });

  test('the daily job never passes the offline seam', () => {
    // --generated-dir reads local files. A control that can be handed its own
    // answer can be made to agree with anything, so CI must never use it.
    const jobStart = daily.indexOf('snapshot-regeneration:');
    expect(jobStart).toBeGreaterThan(-1);
    expect(daily.slice(jobStart)).not.toContain('--generated-dir ');
  });

  test('the daily job fails loudly on a missing credential rather than skipping', () => {
    // KAN-167 forbids `if: env.X != ''`. The job asserts the token is present
    // as its own step so the absence is a red run, not reduced coverage.
    const job = daily.slice(daily.indexOf('snapshot-regeneration:'));
    expect(job).toContain('SUPABASE_ACCESS_TOKEN is not set');
    expect(job).not.toMatch(/if:\s*env\.SUPABASE_ACCESS_TOKEN\s*!=\s*''/);
  });

  test('the failure handler branches on the exit code', () => {
    // Without this, exit 2 renders as exit 1 and the annotation tells the
    // reader to regenerate a snapshot that was never wrong. That exact defect
    // was observed in the sibling ledger-parity job on 2026-08-14.
    const job = daily.slice(daily.indexOf('snapshot-regeneration:'));
    expect(job).toContain('steps.compare.outputs.rc');
    expect(job).toContain('This is not a drift finding');
  });

  test('every PR proves the comparison can still fail', () => {
    expect(prChecks).toContain(`python3 ${SCRIPT} --self-test`);
  });

  test('it is registered in the control registry', () => {
    const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'controls/registry.json'), 'utf-8'));
    const entry = registry.controls.find((c) => c.id === 'CTL-071');
    expect(entry).toBeDefined();
    expect(entry.implementation).toBe(SCRIPT);
    expect(entry.prevents).toContain('SEC-151');
    // No annotation escape hatch, and that is deliberate: an ACCEPTED
    // difference between a snapshot and its own database is precisely the
    // defect this control exists to find.
    expect(entry.escape_hatch).toMatch(/^none/);
  });
});
