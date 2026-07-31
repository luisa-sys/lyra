/**
 * KAN-414 F1 — tests for scripts/check-guard-path-drift.py.
 *
 * The required case list is KAN-419 §7.9. Cases 12–13 (fail-closed) are called
 * out there as "the ones most likely to be skipped under time pressure. They
 * are not optional."
 *
 * WHY THE DESTRUCTIVE CASES RUN IN A CLONE
 * ----------------------------------------
 * Proving drift detection means actually moving a file or corrupting an
 * artefact. Doing that in the working tree would be a live hazard: Jest runs
 * test FILES in parallel workers, and at least five other suites read the exact
 * files these cases mutate — supabase-service-factory, metrics-admin-window,
 * check-extraction-dod, check-routine-ownership, check-doc-mirror-manifest. A
 * `finally` that restores the file does not help a suite that read it mid-flight.
 * Flaky tests get muted, and a muted test is a deleted test.
 *
 * So the mutating cases run against a throwaway `git clone --local` of the repo,
 * which is a real tree with all 18 registered artefacts present (so exit 2 does
 * not mask the assertion) and is invisible to every other worker. Read-only
 * cases still run against the real repo, because there the live estate IS the
 * thing under test.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SRC } = require('../support/source-paths.json');

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT_REL = SRC.checkGuardPathDrift;
const SCRIPT = path.join(ROOT, SCRIPT_REL);

let SANDBOX = null;
let SANDBOX_SCRIPT = null;

function runAt(scriptPath, args = [], cwd = ROOT) {
  try {
    const stdout = execFileSync('python3', [scriptPath, ...args], {
      encoding: 'utf-8',
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, exitCode: 0 };
  } catch (err) {
    return { stdout: err.stdout ?? '', exitCode: err.status ?? 1 };
  }
}

const run = (args = []) => runAt(SCRIPT, args);
const runSandbox = (args = []) => runAt(SANDBOX_SCRIPT, args, SANDBOX);

/** Edit a file inside the sandbox. No restore needed — the clone is disposable. */
function sandboxWrite(rel, transform) {
  const p = path.join(SANDBOX, rel);
  fs.writeFileSync(p, transform(fs.readFileSync(p, 'utf-8')));
}

beforeAll(() => {
  SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-path-drift-'));
  execFileSync('git', ['clone', '--local', '--quiet', ROOT, SANDBOX], { stdio: 'ignore' });
  // The guard resolves its repo root from __file__, so copying it into the
  // clone is what points it at the clone. It is untracked in ROOT, so the
  // clone does not carry it.
  SANDBOX_SCRIPT = path.join(SANDBOX, SCRIPT_REL);
  fs.copyFileSync(SCRIPT, SANDBOX_SCRIPT);
}, 120000);

afterAll(() => {
  if (SANDBOX) fs.rmSync(SANDBOX, { recursive: true, force: true });
});

describe('check-guard-path-drift.py — matcher semantics (§7.9 cases 4–11)', () => {
  test('self-test passes in full', () => {
    const r = run(['--self-test']);
    expect(r.stdout).toMatch(/self-test: \d+\/\d+ passed/);
    expect(r.stdout).not.toMatch(/FAIL/);
    expect(r.exitCode).toBe(0);
  });

  test('bash * crossing / is proven, not assumed (case 4)', () => {
    // The false-DEAD trap: fnmatch reports 0 here. If this case is ever removed
    // the guard can silently start calling the largest protected pattern in the
    // estate dead — and the "fix" would be to weaken the real gate.
    const r = run(['--self-test']);
    expect(r.stdout).toMatch(/ok +bash-case \* crosses \//);
    expect(r.stdout).toMatch(/ok +bash-case trailing \/\*\* prefix/);
    expect(r.stdout).toMatch(/ok +codeowners root anchoring/);
    expect(r.stdout).toMatch(/ok +glob \*\* spans depth/);
  });
});

describe('check-guard-path-drift.py — the live estate (read-only)', () => {
  test('every registered pattern in the real repo matches something', () => {
    const r = run();
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/\d+ registered patterns — \d+ live, \d+ excepted, 0 dead\./);
  });

  test('a passing run still shows the estate was actually checked', () => {
    // A guard that prints nothing on success is indistinguishable from one that
    // did not run.
    const r = run();
    expect(r.stdout).toMatch(/OK {2}\.github\/signup-surface\.paths — \d+\/\d+ live/);
    expect(r.stdout).toMatch(/OK {2}scripts\/check-ui-copy-ownership\.sh/);
  });

  test('every active exception is printed, and each carries a Jira key (case 16)', () => {
    const r = run();
    expect(r.stdout).toMatch(/Active guard-path-ok exceptions \(\d+\)/);
    const block = r.stdout.split('Active guard-path-ok exceptions')[1] || '';
    const lines = block.split('\n').filter((l) => l.trim().startsWith('- '));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(/\[[A-Z]+-\d+\]/);
  });
});

describe('check-guard-path-drift.py — drift detection (sandboxed)', () => {
  test('the sandbox starts clean, so any failure below is caused by the mutation', () => {
    const r = runSandbox();
    expect(r.exitCode).toBe(0);
  });

  // §7.9 case 2.
  test('a moved file that disarms a control fails with exit 1 and names it', () => {
    const from = path.join(SANDBOX, SRC.supabaseService);
    const toDir = path.join(SANDBOX, 'src/modules/platform/data');
    fs.mkdirSync(toDir, { recursive: true });
    execFileSync('git', ['mv', from, path.join(toDir, 'supabase-service.ts')], { cwd: SANDBOX });

    const r = runSandbox();
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toMatch(/guard-path-drift: pattern matches no tracked file/);
    expect(r.stdout).toMatch(/src\/lib\/supabase-service\.ts/);
    expect(r.stdout).toMatch(/This control is not operating/);
    // The remedy must be in the message, not just the failure.
    expect(r.stdout).toMatch(/guard-path-ok: <JIRA-KEY>/);
  });

  test('that one move disarms MORE THAN ONE control', () => {
    // Recorded because it is the whole argument for the guard: the blast radius
    // of a single `git mv` is not obvious by inspection. This is literally D1's
    // work — moving the platform factory into src/modules/platform/data.
    const r = runSandbox();
    expect(r.stdout).toMatch(/signup-surface\.paths/);
    expect(r.stdout).toMatch(/check-service-role-client\.sh/);
    expect(r.stdout).toMatch(/2 path pattern\(s\) match nothing/);
  });

  // §7.9 case 3 — the subtle one.
  test('a pattern matching ONLY an untracked file still fails', () => {
    // git ls-files is the resolution set precisely so this fails: CI checks out
    // tracked content, so such a pattern is inert there even though it looks
    // alive on the author's machine.
    const dir = path.join(SANDBOX, 'src/untracked-probe');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'thing.ts'), 'export {};\n');
    sandboxWrite(SRC.signupSurface, (s) => `${s}\nsrc/untracked-probe/**\n`);

    const r = runSandbox();
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toMatch(/src\/untracked-probe/);
  });

  // §7.9 case 15.
  test('an escape-hatch marker without a Jira key does NOT suppress', () => {
    sandboxWrite(SRC.signupSurface, (s) =>
      `${s}\nsrc/nope/a/**   # guard-path-ok: no key here\n`);
    const r = runSandbox();
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toMatch(/carries no Jira key/);
  });

  // §7.9 case 14.
  test('a valid hatch suppresses exactly its own pattern, not its neighbour', () => {
    sandboxWrite(SRC.signupSurface, (s) =>
      `${s}\nsrc/nope/b/**   # guard-path-ok: KAN-414 fixture\nsrc/nope/c/**\n`);
    const r = runSandbox();
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toMatch(/src\/nope\/b\/\*\*.*\[KAN-414\]/);
    expect(r.stdout).toMatch(/pattern matches no tracked file — 'src\/nope\/c\/\*\*'/);
  });
});

describe('check-guard-path-drift.py — fail-closed (§7.9 cases 12–13, NOT optional)', () => {
  test('a MISSING artefact exits 2 — not 0, and not 1', () => {
    const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'gpd-missing-'));
    try {
      execFileSync('git', ['clone', '--local', '--quiet', ROOT, sb], { stdio: 'ignore' });
      const script = path.join(sb, SCRIPT_REL);
      fs.copyFileSync(SCRIPT, script);
      fs.rmSync(path.join(sb, 'stryker.config.mjs'));

      const r = runAt(script, [], sb);
      expect(r.exitCode).toBe(2);
      expect(r.exitCode).not.toBe(0);
      expect(r.exitCode).not.toBe(1);
      expect(r.stdout).toMatch(/cannot verify the estate/);
      expect(r.stdout).toMatch(/Failing closed/);
    } finally {
      fs.rmSync(sb, { recursive: true, force: true });
    }
  }, 120000);

  test('an artefact present but UNPARSEABLE exits 2', () => {
    const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'gpd-unparseable-'));
    try {
      execFileSync('git', ['clone', '--local', '--quiet', ROOT, sb], { stdio: 'ignore' });
      const script = path.join(sb, SCRIPT_REL);
      fs.copyFileSync(SCRIPT, script);
      const doc = path.join(sb, 'docs/DOC_SOURCE_OF_TRUTH.md');
      fs.writeFileSync(
        doc,
        fs.readFileSync(doc, 'utf-8').replace('<!-- doc-mirror-manifest:end -->', ''),
      );

      const r = runAt(script, [], sb);
      expect(r.exitCode).toBe(2);
      expect(r.stdout).toMatch(/delimiters missing/);
    } finally {
      fs.rmSync(sb, { recursive: true, force: true });
    }
  }, 120000);

  test('an empty pattern list is unparseable, never a vacuous pass', () => {
    // The defect class this whole programme exists to kill: "found nothing to
    // check" must never read as "everything is fine".
    const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'gpd-vacuous-'));
    try {
      execFileSync('git', ['clone', '--local', '--quiet', ROOT, sb], { stdio: 'ignore' });
      const script = path.join(sb, SCRIPT_REL);
      fs.copyFileSync(SCRIPT, script);
      fs.writeFileSync(path.join(sb, SRC.signupSurface), '# all commented out\n');

      const r = runAt(script, [], sb);
      expect(r.exitCode).toBe(2);
      expect(r.stdout).toMatch(/declared no patterns/);
    } finally {
      fs.rmSync(sb, { recursive: true, force: true });
    }
  }, 120000);
});
