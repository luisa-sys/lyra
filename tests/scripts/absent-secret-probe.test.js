const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { SRC } = require('../support/source-paths.json');

const REPO_ROOT = path.resolve(__dirname, '../../');
// Reached via SRC, and seeded in source-path-seeds.ts so the key survives a
// regeneration from a stale checkout. A lost key would make this
// `execFileSync(undefined)` — a broken harness, which reads as noise rather
// than as a lost control (gotcha #31).
const SCRIPT = path.join(REPO_ROOT, SRC.checkAbsentSecretProbe);
const LEDGER = path.join(REPO_ROOT, '.github', 'absent-secrets.txt');
const PROBE = path.join(REPO_ROOT, '.github', 'workflows', 'absent-secrets-probe.yml');

/**
 * SEC-158 / CTL-068 — a recorded secret ABSENCE must be able to stop being true.
 *
 * THE DEFECT. `.github/absent-secrets.txt` records secrets a workflow
 * references that deliberately do not exist. `check-workflow-secret-refs.py`
 * fails when a workflow names a secret in NEITHER ledger — and never asks the
 * reverse question, *is this absence still real?* So an entry passes forever
 * once its secret is provisioned.
 *
 * Observed, not theorised: `SUPABASE_ACCESS_TOKEN` sat there under ~20 lines
 * asserting CTL-049 "fails LOUDLY every day", while db-invariants run
 * 31932614624 shows its `[ -z ... ] && exit 1` presence step PASSING and three
 * projects' ledgers read over the Management API.
 *
 * WHY THE COVERAGE IS SPLIT ACROSS TWO ARTEFACTS, which is the thing to
 * understand before changing either:
 *
 *   - THIS script answers a DIFF question — have the ledger and the generated
 *     probe drifted? Checkable in a PR.
 *   - The PROBE answers a STATE-OF-THE-WORLD question — is a listed secret now
 *     present? Nothing in a pull request can change that, and it can become
 *     true while no PR is open, so it runs on a schedule.
 *
 * Collapsing them into one would mean either a PR check that cannot see the
 * real defect, or a scheduled job that cannot stop the drift being merged.
 */

function run(args = [], opts = {}) {
  try {
    return {
      code: 0,
      out: execFileSync('python3', [SCRIPT, ...args], {
        cwd: opts.cwd || REPO_ROOT,
        stdio: 'pipe',
      }).toString(),
    };
  } catch (err) {
    return { code: err.status, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

describe('CTL-068 — the checker itself', () => {
  test('its --self-test passes', () => {
    const r = run(['--self-test']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/self-test: (\d+)\/\1 passed/);
    expect(r.out).not.toMatch(/FAIL/);
  });

  test('the real ledger and the real probe agree today', () => {
    const r = run();
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/covers all \d+ ledger entr/);
  });
});

describe('the generated probe is not decorative', () => {
  test('every ledger entry gets a literal `secrets.X != \'\'` expression', () => {
    // The whole mechanism rests on this: `secrets[NAME]` cannot be indexed
    // dynamically in workflow YAML, so if a name is not present as a LITERAL,
    // that entry is simply not covered and nothing says so.
    const ledger = fs
      .readFileSync(LEDGER, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.split('#')[0].trim())
      .filter(Boolean);

    // Assert the corpus BEFORE iterating it. An empty ledger would make every
    // assertion below vacuously true (catalogue failure mode 4).
    expect(ledger.length).toBeGreaterThan(0);

    const probe = fs.readFileSync(PROBE, 'utf8');
    for (const name of ledger) {
      expect(probe).toContain(`secrets.${name} != ''`);
    }
  });

  test('each probe step FAILS when the secret is present, not when it is absent', () => {
    // The direction is the entire point and is easy to invert by accident. The
    // step must be conditional on the secret EXISTING — that is the stale case.
    //
    // ⚠️ CHANGED ASSERTION — SEC-165, and it needs Luisa's Test Integrity
    // sign-off. This line read:
    //
    //     expect(probe).toMatch(/if: \$\{\{ secrets\.[A-Z0-9_]+ != '' \}\}/)
    //
    // which pinned a shape GitHub REFUSES TO RUN. The `secrets` context is not
    // available in a step-level `if:`, so that file was invalid: 43 runs on
    // this repository, every one `failure`, zero jobs started, zero successes,
    // and not one scheduled execution. The assertion was green throughout —
    // it was checking the source text of a control that had never once fired.
    //
    // The intent is unchanged and the encoding is strictly stronger: the same
    // direction is asserted at the location GitHub actually evaluates it, and
    // the old shape is now a NEGATIVE assertion so the regression reddens here
    // rather than merely reappearing in the CTL-073 lint baseline.
    const probe = fs.readFileSync(PROBE, 'utf8');
    expect(probe).toMatch(/^\s+PROBE_HAS_[A-Z0-9_]+: \$\{\{ secrets\.[A-Z0-9_]+ != '' \}\}$/m);
    expect(probe).toMatch(/^\s+if: env\.PROBE_HAS_[A-Z0-9_]+ == 'true'$/m);
    expect(probe).not.toMatch(/^\s*if:\s*\$\{\{\s*secrets\./m);
    expect(probe).toContain('exit 1');
    // And it must say what to do, or a future reader will just delete the step.
    expect(probe).toContain('known-secrets.txt');
  });

  test('the env key and the secret it tests are the SAME name', () => {
    // A step gated on PROBE_HAS_A while the env line computes it from
    // secrets.B would be a control pointed at the wrong secret, and every
    // other assertion here would still pass. Checked pairwise, per entry.
    const probe = fs.readFileSync(PROBE, 'utf8');
    const pairs = [
      ...probe.matchAll(/^\s+PROBE_HAS_([A-Z0-9_]+): \$\{\{ secrets\.([A-Z0-9_]+) != '' \}\}$/gm),
    ];
    expect(pairs.length).toBeGreaterThan(0); // corpus first (failure mode 4)
    for (const [, envName, secretName] of pairs) {
      expect(envName).toBe(secretName);
    }
    // …and every one of those env keys is actually consumed by a step.
    for (const [, envName] of pairs) {
      expect(probe).toContain(`if: env.PROBE_HAS_${envName} == 'true'`);
    }
  });

  test('every ledger entry has BOTH halves — no entry gated on nothing', () => {
    // The two halves are generated independently. An entry present in the env
    // block but with no step, or a step whose env key was never computed,
    // would silently never fire — `env.MISSING == 'true'` is simply false.
    const ledger = fs
      .readFileSync(LEDGER, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.split('#')[0].trim())
      .filter(Boolean);
    expect(ledger.length).toBeGreaterThan(0);

    const probe = fs.readFileSync(PROBE, 'utf8');
    for (const name of ledger) {
      expect(probe).toContain(`PROBE_HAS_${name}: \${{ secrets.${name} != '' }}`);
      expect(probe).toContain(`if: env.PROBE_HAS_${name} == 'true'`);
    }
  });

  test('it never reads a secret VALUE — only the boolean', () => {
    // A probe that echoed `${{ secrets.X }}` would leak the secret into logs
    // while "checking" it. Assert the only interpolation is the comparison.
    const probe = fs.readFileSync(PROBE, 'utf8');
    const interpolations = probe.match(/\$\{\{[^}]*secrets\.[^}]*\}\}/g) || [];
    expect(interpolations.length).toBeGreaterThan(0);
    for (const expr of interpolations) {
      expect(expr).toMatch(/secrets\.[A-Z0-9_]+ != ''/);
    }
  });

  test('the probe is marked generated, so nobody hand-edits it', () => {
    const probe = fs.readFileSync(PROBE, 'utf8');
    expect(probe).toContain('DO NOT EDIT BY HAND');
    expect(probe).toContain(SRC.checkAbsentSecretProbe);
  });
});

describe('SEC-165 — the probe has been SEEN to fire', () => {
  /**
   * The defect this closes is not "a wrong expression". It is that nothing had
   * ever asked what happens when a listed secret IS present — so a control
   * that GitHub refused to run at all (43 runs, 0 jobs, 0 successes) reported
   * nothing wrong for as long as it existed.
   *
   * These drive the REAL evaluator in the generator against the REAL committed
   * probe, in both directions.
   *
   * ⚠️ STATED GAP: `--simulate` models GitHub's documented evaluation of the
   * two expressions the generator emits; it does not execute GitHub's
   * expression engine. It proves the two halves agree and point the right way.
   * That the file is ACCEPTED is proven separately, by actionlint via CTL-073.
   */
  const ledgerNames = () =>
    fs
      .readFileSync(LEDGER, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.split('#')[0].trim())
      .filter(Boolean);

  test('with every recorded absence still real, NOTHING fires', () => {
    const r = run(['--simulate', '']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('simulate: 0 step(s) would fail');
    expect(r.out).not.toContain('FIRES');
  });

  test('each ledger entry fires on its own when that secret appears', () => {
    const names = ledgerNames();
    expect(names.length).toBeGreaterThan(0); // corpus first (failure mode 4)
    for (const name of names) {
      const r = run(['--simulate', name]);
      expect(r.code).toBe(0);
      expect(r.out).toContain(`FIRES ${name}`);
      expect(r.out).toContain('simulate: 1 step(s) would fail');
    }
  });

  test('a secret NOT in the ledger fires nothing — no over-broad gate', () => {
    const r = run(['--simulate', 'SOME_SECRET_NOT_IN_THE_LEDGER']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('simulate: 0 step(s) would fail');
  });

  test('all of them present fires all of them, not just the first', () => {
    const names = ledgerNames();
    const r = run(['--simulate', names.join(',')]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`simulate: ${names.length} step(s) would fail`);
  });
});

describe('regenerating does not revert a dependabot action bump', () => {
  /**
   * FOUND BY MUTATION while building SEC-165, not theorised. `render()` bakes
   * an `actions/checkout` pin into the generated file, and `check()` compares
   * only secret NAMES — so a `--write` that ignored the existing pin would
   * silently roll a security bump back and every test in this file stayed
   * green. It did: dependabot's #841 bump was reverted to the generator's
   * older literal with 17/17 passing.
   *
   * The self-test covers `render(names, checkout)` in isolation; this covers
   * the `--write` PATH, which is where the argument is actually supplied and
   * where the mutation lived. Testing the function and not its only caller is
   * how that gap existed in the first place.
   *
   * Deliberately NOT an equality gate between the generator's literal and the
   * committed file: dependabot cannot edit the .py, so such a gate would be
   * permanently unsatisfiable for the one author that trips it (gotcha #34).
   */
  const BUMPED = `actions/checkout@${'a'.repeat(40)} # v9`;

  function sandbox() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'absent-probe-'));
    fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.copyFileSync(LEDGER, path.join(dir, '.github', 'absent-secrets.txt'));
    fs.copyFileSync(SCRIPT, path.join(dir, SRC.checkAbsentSecretProbe));
    return dir;
  }

  test('--write carries the committed pin forward instead of resetting it', () => {
    const dir = sandbox();
    const probe = path.join(dir, '.github', 'workflows', 'absent-secrets-probe.yml');
    const original = fs.readFileSync(PROBE, 'utf8');
    const current = original.match(/actions\/checkout@[0-9a-f]{40}[^\n]*/)[0];
    // Stand in for a dependabot bump: same file, newer pin.
    fs.writeFileSync(probe, original.replace(current, BUMPED));

    const r = run(['--write'], { cwd: dir });
    expect(r.code).toBe(0);
    const after = fs.readFileSync(probe, 'utf8');
    expect(after).toContain(BUMPED);
    // The bump must survive; the pre-bump pin must not come back.
    expect(after).not.toContain(current.split(' ')[0]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('--write into a fresh tree still produces a pinned checkout', () => {
    // The other direction: with nothing to carry forward, the fallback is used
    // rather than an unpinned `actions/checkout@v6`, which check-action-pinning
    // would reject.
    const dir = sandbox();
    const r = run(['--write'], { cwd: dir });
    expect(r.code).toBe(0);
    const after = fs.readFileSync(
      path.join(dir, '.github', 'workflows', 'absent-secrets-probe.yml'), 'utf8');
    expect(after).toMatch(/uses: actions\/checkout@[0-9a-f]{40} # v\d+/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('it is wired in', () => {
  test('pr-checks.yml runs both the self-test and the check', () => {
    // ⚠️ THE FULL COMMANDS, not the script name and the flag separately. An
    // earlier test elsewhere in this estate asserted those two independently
    // and stayed green when the real invocation was deleted, because the name
    // matched its own --self-test line and the flag matched a neighbouring
    // step. Two assertions, both satisfied by lines other than the one meant.
    const wf = fs.readFileSync(
      path.join(REPO_ROOT, '.github', 'workflows', 'pr-checks.yml'), 'utf8');
    expect(wf).toContain(`python3 ${SRC.checkAbsentSecretProbe} --self-test`);
    expect(wf).toContain(`python3 ${SRC.checkAbsentSecretProbe}\n`);
  });

  test('the probe workflow re-checks the ledger before trusting its own steps', () => {
    // Belt and braces: a ledger edited without regenerating would leave the
    // steps under-covering it, and the probe would report green having checked
    // less than it claims.
    const probe = fs.readFileSync(PROBE, 'utf8');
    expect(probe).toContain(`python3 ${SRC.checkAbsentSecretProbe}`);
  });

  test('is registered in the control registry', () => {
    const reg = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'controls/registry.json'), 'utf8'));
    const controls = reg.controls || reg;
    const entry = controls.find((c) => c.id === 'CTL-068');
    expect(entry).toBeDefined();
    expect(entry.implementation).toBe(SRC.checkAbsentSecretProbe);
    expect(entry.prevents).toContain('SEC-158');
    expect(entry.wired_in.length).toBeGreaterThan(0);
  });
});

describe('SEC-158 itself is fixed — the entry that proved the gap is gone', () => {
  test('SUPABASE_ACCESS_TOKEN is NOT listed as absent', () => {
    // It exists and works: db-invariants run 31932614624's presence step passed
    // and read three projects' migration ledgers.
    const ledger = fs.readFileSync(LEDGER, 'utf8');
    const active = ledger
      .split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('#'))
      .join('\n');
    expect(active).not.toContain('SUPABASE_ACCESS_TOKEN');
  });

  test('…and it IS listed as known to exist', () => {
    // The paired half. Without this, deleting the entry from BOTH files would
    // satisfy the assertion above while losing the record entirely.
    const known = fs.readFileSync(
      path.join(REPO_ROOT, '.github', 'known-secrets.txt'), 'utf8');
    expect(known).toMatch(/^SUPABASE_ACCESS_TOKEN$/m);
  });
});
