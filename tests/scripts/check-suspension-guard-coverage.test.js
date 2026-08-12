/**
 * CTL-028 — tests for scripts/check-suspension-guard-coverage.py.
 *
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------
 * Until SEC-104 step 3, this control had NO tests. Its only cover was its own
 * `--self-test`, which is the control grading its own homework: nothing
 * asserted the self-test still ran a meaningful number of cases, nothing
 * asserted it was wired into CI, and nothing asserted it could still fail.
 *
 * That mattered, because it turned out to be scanning nothing. The SEC-104
 * migration moved every public surface out of its scope — the predicates went
 * into the `public_profiles` view body, so a correctly-migrated read no longer
 * contains the `is_published` literal the old rule was keyed on:
 *
 *     62db86b~1   6 chains visible — 4 of them public
 *     after       2 chains visible — 0 of them public
 *
 * and the control printed "Every public-visibility query also filters suspended
 * members. ✓" while looking at an admin count and a dashboard action.
 *
 * ⚠️ THE DISTRIBUTION IS THE POINT, NOT THE COUNT. `--self-test N/N passed`
 * says nothing about WHICH code paths the N cover — SEC-133's lesson, where
 * nine green fixtures sat beside a comparator with zero. So the floor below is
 * necessary but not sufficient, and the tests after it assert that each of the
 * three rule families is represented BY NAME.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { SRC } = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'tests/support/source-paths.json'), 'utf-8'),
);
const SCRIPT = path.join(ROOT, SRC.checkSuspensionGuardCoverage);

/**
 * Committed MINIMUM number of self-test fixtures. May be raised, never lowered.
 *
 * SEC-104 step 3: 6 -> 21. The rewrite added 7 base-table fixtures and 8
 * public-surface classification fixtures. Leaving the floor at 6 would have let
 * every one of the new cases be deleted with the suite still green — on the
 * only rule that can see the defect this control was rewritten for.
 */
const SELF_TEST_FLOOR = 21;

function run(args = [], opts = {}) {
  return spawnSync('python3', [SCRIPT, ...args], {
    encoding: 'utf-8',
    cwd: opts.cwd || ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'en_GB.UTF-8' },
  });
}

describe('CTL-028 — public surfaces may not read the profiles base table', () => {
  test('the self-test passes, and runs at least its committed floor', () => {
    const r = run(['--self-test']);
    expect(r.status).toBe(0);

    const m = /all (\d+) fixture case\(s\) behave as specified/.exec(r.stdout);
    expect(`self-test summary present: ${Boolean(m)}`).toBe('self-test summary present: true');
    expect(Number(m[1])).toBeGreaterThanOrEqual(SELF_TEST_FLOOR);
    expect(r.stdout).not.toMatch(/FAIL/);
  });

  test('SEC-104: the self-test covers all THREE rule families, by name', () => {
    // A floor guards the count. This guards the distribution — the failure that
    // a healthy count cannot distinguish from real coverage.
    const { stdout } = run(['--self-test']);
    for (const family of ['[retained]', '[base-table]', '[surface]']) {
      expect(`${family} present: ${stdout.includes(family)}`).toBe(`${family} present: true`);
    }
  });

  test("SEC-104: it catches the case the OLD rule could not see", () => {
    // The defect this rewrite exists for: a service-role read of `profiles`
    // with NO filters at all. The old rule triggered on the PRESENCE of a
    // partial guard, so this returned zero findings. Asserted through the
    // fixture the checker names, so deleting the fixture fails here too.
    const { stdout } = run(['--self-test']);
    expect(stdout).toMatch(/\[base-table\] SEC-104's invisible case: no filters at all \(expected 1, got 1\)/);
  });

  test('SEC-104: default-deny — a new public route is in scope without being listed', () => {
    // The property that separates this from the CTL-013 signup manifest, whose
    // failure mode is a confident RESULT: CLEAN after a rename (gotcha #32).
    // Public surfaces are not enumerated, so a route nobody remembered to
    // register is still covered.
    const { stdout } = run(['--self-test']);
    expect(stdout).toMatch(/\[surface\] a public route is in scope \(expected true, got true\)/i);
    expect(stdout).toMatch(
      /\[surface\] the PUBLIC recommendations API stays in scope \(expected true, got true\)/i,
    );
    // ...and the authenticated areas are NOT in scope, or the control would be
    // unusable noise on 26 legitimate own-row readers.
    expect(stdout).toMatch(/\[surface\] the dashboard is carved out \(expected false, got false\)/i);
  });

  test('SEC-104: comments are stripped, so documenting the hazard is not a violation', () => {
    // CTL-039 / SEC-100: `is_published` occurred twice in sitemap.ts — once in
    // the query and once in the comment explaining it — so deleting the filter
    // left a source-text scan green. The inverse hazard applies here: a guard
    // that flagged prose would punish writing the explanation down, and this
    // checker's own header discusses `.from('profiles')` at length.
    const { stdout } = run(['--self-test']);
    expect(stdout).toMatch(/a line comment mentioning it is not a violation \(expected 0, got 0\)/);
    expect(stdout).toMatch(/a block comment mentioning it is not a violation \(expected 0, got 0\)/);
  });

  test('⚠️ FAILS CLOSED: a missing src/app exits 2, it does not report a clean scan', () => {
    // Gotcha #30 — a BSD/GNU grep divergence let a sibling guard print its
    // success line having searched nothing. The precondition is asserted
    // directly here rather than inferred from a downstream count.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctl028-'));
    try {
      const r = run([], { cwd: tmp });
      expect(r.status).toBe(2);
      expect(r.stdout + r.stderr).toMatch(/missing or unreadable/);
      expect(r.stdout + r.stderr).toMatch(/Failing closed/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('it passes on the real tree, and says how much it actually scanned', () => {
    // A control that reports a clean result without saying what it covered is
    // indistinguishable from one that covered nothing — which is precisely how
    // the previous version read while scanning zero public surfaces.
    const r = run([]);
    expect(r.status).toBe(0);

    const m = /Scanning (\d+) public-surface file\(s\).*?\((\d+) public_profiles read\(s\)/.exec(
      r.stdout,
    );
    expect(`coverage line present: ${Boolean(m)}`).toBe('coverage line present: true');
    const [, files, viewReads] = m.map(Number);
    // Floors, not exact values, so adding a route does not fail the build. The
    // point is that neither number can quietly reach zero.
    expect(files).toBeGreaterThan(20);
    expect(viewReads).toBeGreaterThanOrEqual(6);
  });

  test('it is registered as a control and actually invoked by pr-checks', () => {
    // CTL-041's lesson: a registered control nothing invokes is a claim, not a
    // gate — the SEC-79 failure mode where two workflows sat disabled for over
    // a month while still reporting green.
    const registry = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'controls/registry.json'), 'utf-8'),
    );
    const entry = registry.controls.find((c) => c.id === 'CTL-028');
    expect(entry).toBeDefined();
    expect(entry.implementation).toBe(SRC.checkSuspensionGuardCoverage);
    expect(entry.wired_in.length).toBeGreaterThan(0);

    for (const wf of entry.wired_in) {
      const yml = fs.readFileSync(path.join(ROOT, wf), 'utf-8');
      expect(`${wf} invokes it: ${yml.includes(entry.implementation)}`).toBe(
        `${wf} invokes it: true`,
      );
    }
    // SEC-104 is the ticket that rewrote it; the registry must say so, or the
    // defect-feedback loop loses the link between the fix and its lesson.
    expect(entry.prevents).toContain('SEC-104');
  });

  test('SEC-104: the six migrated read sites are still reading the view', () => {
    // The regression this control could NOT observe before the rewrite:
    // switching a public surface back to the base table. Asserted on the tree
    // rather than through the checker, so it holds even if the checker changes.
    const sites = [SRC.slugPage, SRC.searchPage, SRC.sitemap, SRC.slugRoute, SRC.v2SlugRoute];
    // Assert the corpus before iterating it — catalogue failure mode 4, where a
    // parameterised test over an empty list registers zero cases and is green.
    expect(sites.filter(Boolean)).toHaveLength(5);
    for (const rel of sites) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
      expect(`${rel} reads public_profiles: ${/\.from\(\s*'public_profiles'\s*\)/.test(src)}`).toBe(
        `${rel} reads public_profiles: true`,
      );
    }
  });
});
