/**
 * CTL-049 / SEC-137 — the control that asks whether the schema can be REBUILT
 * from the repo, rather than whether it is currently right.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Three database controls already run (CTL-036, CTL-048, check-db-invariants).
 * All three were green on 2026-08-12 and all three were correct. None of them
 * reads `supabase/migrations/`, so none could see that the repo cannot rebuild
 * the databases: `mcp_tool_call_log` and `content_moderation_flags` are live
 * tables on all three environments with no migration SQL in version control,
 * and production's ledger has no row for `create_lyra_schema` at all.
 *
 * This file guards the guard. It reaches the REAL script by subprocess rather
 * than reimplementing any of its logic (CTL-038): a private copy of the
 * comparison would keep passing while the shipped one drifted, which is the
 * failure this whole control is about.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not contact the databases — no credentials in a unit run, by design.
 * The live half is asserted daily by `db-invariants.yml`. What is testable
 * without credentials is the comparison, the ratchet, and the fail-closed
 * behaviour, and those are where the defects live.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { SRC } = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../support/source-paths.json'), 'utf-8'),
);

// Routed through the manifest, not spelled. The F4 raw-literal ratchet is
// SHRINK-ONLY, so a new test file that adds literals must either convert them
// or raise a baseline it is not allowed to raise — and "raise the baseline"
// is the easy wrong move that turns a ratchet into a suppression list.
// `controls/registry.json` stays a literal below because the generator only
// harvests src|supabase|scripts|public|design|.github prefixes, so `controls/`
// is neither manifest-able nor counted.
const SCRIPT = SRC.checkMigrationLedgerParity;
const BASELINE = SRC.migrationLedgerBaseline;
const WORKFLOW = SRC.dbInvariants;

/**
 * Run the real script. Returns {code, out} rather than throwing, because the
 * non-zero exits ARE the behaviour under test — a helper that threw on them
 * would make the interesting cases unwritable.
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
 * The script's own fixture count. Pinned so the self-test cannot quietly
 * shrink — a self-test that stops testing things still prints "passed",
 * which is indistinguishable from one that tests everything.
 *
 * RAISED 29 -> 44 for SEC-160. Two separate things happened and only one of
 * them is "we added cases":
 *
 *   * the script's reported count was a hand-maintained constant reading 29
 *     while its `check()` calls actually evaluated 33 — understating by four,
 *     because several cases live inside loops and nobody re-counted. It now
 *     increments inside the assertion, so the number is what ran.
 *   * SEC-160 added 11 more, for 44.
 *
 * That the pinned floor and the real count had silently diverged is the point:
 * a number a human has to remember to raise is a number that goes stale, which
 * is CLAUDE.md catalogue failure mode 8 turning up inside a control's own
 * self-test. Raising this floor is allowed; lowering it to make a run green is
 * not.
 */
const SELF_TEST_FLOOR = 44;

describe('CTL-049 — migration ledger parity', () => {
  test('the self-test passes and has not silently shrunk', () => {
    const { code, out } = run(['--self-test']);
    expect(`exit ${code}: ${out.trim()}`).toContain('Self-test passed');
    expect(code).toBe(0);

    const cases = Number(/Self-test passed \((\d+) cases\)/.exec(out)?.[1] ?? 0);
    expect(cases).toBeGreaterThanOrEqual(SELF_TEST_FLOOR);
  });

  test('it fails CLOSED when it cannot reach a database', () => {
    // The SEC-136 failure mode, and the one KAN-167 forbids: a control that
    // passes when it could not run still produces a green tick. Exit 2 is
    // deliberately distinct from exit 1 (ran, found a problem).
    const { code, out } = run([], { SUPABASE_ACCESS_TOKEN: '' });
    expect(out).toContain('::error::');
    expect(out).toContain('SUPABASE_ACCESS_TOKEN is not set');
    expect(code).toBe(2);
  });

  test('every HTTP request it makes is a GET', () => {
    // DELETE on the SAME path rolls migrations out of the history table. A
    // read-only control that gained a mutating verb would be a live hazard,
    // not merely a bug. Asserted on the method argument, not on the word
    // appearing in the file — the source names DELETE deliberately, in the
    // warning explaining why this matters.
    const src = fs.readFileSync(path.join(ROOT, SCRIPT), 'utf-8');
    const code = src
      .replace(/"""[\s\S]*?"""/g, '')
      .split('\n')
      .map((l) => l.split('#')[0])
      .join('\n');
    const methods = [...code.matchAll(/method\s*=\s*"([A-Z]+)"/g)].map((m) => m[1]);
    expect(methods.length).toBeGreaterThan(0);
    expect([...new Set(methods)]).toEqual(['GET']);
  });
});

describe('CTL-049 — the baseline is a ratchet, not a suppression list', () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, BASELINE), 'utf-8'));

  test('it covers all three environments and is non-empty', () => {
    // Catalogue failure mode 4: iterating an empty corpus registers nothing
    // and is green. Assert the corpus before drawing conclusions from it.
    const envs = Object.keys(baseline.environments);
    expect(envs.sort()).toEqual(['dev', 'prod', 'staging']);

    const total = envs.reduce(
      (n, e) =>
        n +
        baseline.environments[e].applied_not_in_repo.length +
        baseline.environments[e].in_repo_not_applied.length,
      0,
    );
    expect(total).toBeGreaterThan(0);
  });

  test('it records the specific unrebuildable migrations that motivated it', () => {
    // Named rather than counted. A count can be satisfied by any 12 entries;
    // these are the ones proven to have no SQL in the repo, and if a future
    // edit drops them the control has stopped covering its own reason to exist.
    const prod = baseline.environments.prod.applied_not_in_repo;
    for (const name of [
      'kan_232_mcp_tool_call_log',
      'kan_244_content_moderation_flags',
      'sec107_add_draft_visibility_label',
    ]) {
      expect(`prod baselines ${name}: ${prod.includes(name)}`).toBe(`prod baselines ${name}: true`);
    }
  });

  test('production still has no record of the base schema being created', () => {
    // The starkest single fact in SEC-137. When this stops being true the
    // baseline must shrink, and the STALE half of the ratchet will say so.
    expect(baseline.environments.prod.in_repo_not_applied).toContain('create_lyra_schema');
  });

  test('every entry is sorted and deduplicated', () => {
    // Generated, never hand-typed — a hand-maintained baseline is the test
    // floor that sat at 29 files against an actual 260. Sortedness is the
    // cheap observable proof that the generator produced this file.
    for (const [env, sets] of Object.entries(baseline.environments)) {
      for (const [key, list] of Object.entries(sets)) {
        const sorted = [...list].sort();
        expect(`${env}.${key} sorted`).toBe(`${env}.${key} sorted`);
        expect(list).toEqual(sorted);
        expect(new Set(list).size).toBe(list.length);
      }
    }
  });

  test('it cites the ticket that explains it', () => {
    expect(baseline.ticket).toMatch(/^[A-Z]+-\d+$/);
  });
});

describe('CTL-049 / SEC-160 — the arm that could not fire', () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, BASELINE), 'utf-8'));
  const reconciliations = baseline.reconciliations ?? [];
  // Routed through the manifest, not spelled — the F4 raw-literal ratchet is
  // shrink-only, and this one literal took it 35 -> 36. Raising a shrink-only
  // baseline to fit a new file is how a ratchet becomes a suppression list.
  const migrations = fs.readdirSync(path.join(ROOT, SRC.migrations));

  test('the baseline carries reconciliations at all', () => {
    // Catalogue failure mode 4: every assertion below iterates this list, and
    // an empty list would make all of them vacuously green. Assert the corpus
    // before drawing any conclusion from it.
    expect(Array.isArray(reconciliations)).toBe(true);
    expect(reconciliations.length).toBeGreaterThan(0);
  });

  test('the three SEC-160 rows are the ones reconciled', () => {
    // Named, not counted. These are the ledger rows whose SQL was genuinely
    // missing from the repo — two live tables and a pair of pg_cron retention
    // jobs on a service holding minors' personal data. A future edit that
    // drops them has stopped covering the reason this mechanism exists.
    const byLedger = Object.fromEntries(reconciliations.map((r) => [r.ledger, r.repo]));
    expect(Object.keys(byLedger).sort()).toEqual([
      'kan_232_mcp_tool_call_log',
      'kan_244_content_moderation_flags',
      'kan_245_mcp_tool_call_log_retention',
    ]);
  });

  test('every reconciliation names a migration file that actually exists', () => {
    // The liveness arm, asserted here as well as in the script's own
    // self-test — because the self-test proves the CHECK works on fixtures,
    // and this proves the SHIPPED baseline currently satisfies it. Those are
    // different claims, and only the second goes stale.
    for (const entry of reconciliations) {
      const found = migrations.some((f) => f.replace(/^\d+_/, '').replace(/\.sql$/, '') === entry.repo);
      expect(`${entry.repo} exists: ${found}`).toBe(`${entry.repo} exists: true`);
    }
  });

  test('every reconciliation names a ledger row the baseline still records as diverging', () => {
    const applied = new Set(
      Object.values(baseline.environments).flatMap((e) => e.applied_not_in_repo),
    );
    for (const entry of reconciliations) {
      expect(`${entry.ledger} still diverges: ${applied.has(entry.ledger)}`).toBe(
        `${entry.ledger} still diverges: true`,
      );
    }
  });

  test('every reconciliation is attributed and explained', () => {
    // A pairing is a CLAIM, not evidence — nothing verifies the named file
    // holds the SQL that ledger row ran. The ticket and the reason are what
    // make it reviewable, which is the only check this mechanism gets.
    for (const entry of reconciliations) {
      expect(entry.ticket).toMatch(/^[A-Z][A-Z0-9]+-\d+$/);
      expect(typeof entry.why === 'string' && entry.why.length > 40).toBe(true);
    }
  });

  test('reconciling did NOT edit the raw applied-not-in-repo measurement', () => {
    // The whole design rests on this. `applied_not_in_repo` stays the raw
    // fact that a migration was applied out of band; the pairing only stops
    // the committed file being reported as unapplied. Deleting the ledger
    // names here would erase the finding while looking like a fix.
    const prod = baseline.environments.prod.applied_not_in_repo;
    for (const entry of reconciliations) {
      if (entry.ledger.startsWith('kan_2')) {
        expect(`prod still records ${entry.ledger}: ${prod.includes(entry.ledger)}`).toBe(
          `prod still records ${entry.ledger}: true`,
        );
      }
    }
  });

  test('the script explains why the ratchet needed this half', () => {
    // Source-text, and comments deliberately NOT stripped: what is asserted
    // here IS the prose. A future reader who finds `reconciliations` and no
    // account of why it is not simply a suppression list has been handed a
    // mechanism with no way to judge a new entry against it.
    const src = fs.readFileSync(path.join(ROOT, SCRIPT), 'utf-8');
    expect(src).toContain('BY CONSTRUCTION');
    expect(src).toContain('A RECONCILIATION IS A CLAIM, NOT EVIDENCE');
  });
});

describe('CTL-049 — is wired in, not merely written', () => {
  // SEC-79: health-check.yml and weekly-report.yml sat disabled for over a
  // month while still reporting green. A control nothing invokes is a file.
  test('the daily workflow runs the LIVE check, not only the self-test', () => {
    // ⚠️ The obvious assertion here is wrong, and was written first:
    //
    //     expect(wf).toContain(SCRIPT)
    //
    // That passes on the self-test step alone. Proven by mutation — replacing
    // the live invocation with `echo "skipped"` left all 10 tests green,
    // because the script's NAME still appeared elsewhere in the file. The
    // string was satisfied for a different reason than the one being asserted,
    // which is catalogue failure mode 2.
    //
    // So assert the invocation that actually contacts the databases: the
    // script run WITHOUT --self-test.
    // Second correction, same lesson from the other side: the failure handler
    // ECHOES `--write-baseline` as operator help, so a naive scan counted a
    // string of documentation as an invocation. Under mutation the real run
    // disappeared, the echoed one took its place in the count, and the test
    // passed. Match executable lines only.
    const wf = fs.readFileSync(path.join(ROOT, WORKFLOW), 'utf-8');
    const invocations = wf
      .split('\n')
      .filter((l) => l.includes(`python3 ${SCRIPT}`) && !/^\s*echo\b/.test(l.trim()))
      .map((l) => l.slice(l.indexOf(SCRIPT) + SCRIPT.length).trim());
    expect(invocations.length).toBeGreaterThan(0);

    const live = invocations.filter((a) => !a.includes('--self-test'));
    expect(`live (non-self-test) invocations: ${live.length}`).toBe(
      'live (non-self-test) invocations: 1',
    );
    // …and it must not be handed its own answer via the offline seam.
    expect(live[0]).not.toContain('--ledger-dir');
  });

  test('it is registered in the control registry', () => {
    const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'controls/registry.json'), 'utf-8'));
    const entry = registry.controls.find((c) => c.id === 'CTL-049');
    expect(entry).toBeDefined();
    expect(entry.implementation).toBe(SCRIPT);
    expect(entry.prevents).toContain('SEC-137');
  });
});
