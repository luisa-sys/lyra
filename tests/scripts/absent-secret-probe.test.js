const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

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
    const probe = fs.readFileSync(PROBE, 'utf8');
    expect(probe).toMatch(/if: \$\{\{ secrets\.[A-Z0-9_]+ != '' \}\}/);
    expect(probe).toContain('exit 1');
    // And it must say what to do, or a future reader will just delete the step.
    expect(probe).toContain('known-secrets.txt');
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
