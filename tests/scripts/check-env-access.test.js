/**
 * KAN-414 F8 — tests for scripts/check-env-access.py (CTL-037).
 *
 * The mutating cases run in a `git clone --local` of the repo, not the working
 * tree: the gate reads every tracked file under src/, so editing src/ in place
 * would race the many other suites that also read those files (Jest runs test
 * files in parallel). A `finally` that restores a file does not help a suite
 * that read it mid-flight.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SRC } = require('../support/source-paths.json');

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT_REL = SRC.checkEnvAccess;
const SCRIPT = path.join(ROOT, SCRIPT_REL);
const BASELINE_REL = 'env-access-baseline.json';

function runAt(scriptPath, args = [], cwd = ROOT) {
  try {
    const stdout = execFileSync('python3', [scriptPath, ...args], {
      encoding: 'utf-8', cwd, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, exitCode: 0 };
  } catch (err) {
    return { stdout: err.stdout ?? '', exitCode: err.status ?? 1 };
  }
}

const run = (args = []) => runAt(SCRIPT, args);

let SANDBOX = null;
let SANDBOX_SCRIPT = null;

beforeAll(() => {
  SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'env-access-'));
  execFileSync('git', ['clone', '--local', '--quiet', ROOT, SANDBOX], { stdio: 'ignore' });
  SANDBOX_SCRIPT = path.join(SANDBOX, SCRIPT_REL);
  // Untracked in ROOT until committed, so copy both in explicitly.
  fs.copyFileSync(SCRIPT, SANDBOX_SCRIPT);
  fs.copyFileSync(path.join(ROOT, BASELINE_REL), path.join(SANDBOX, BASELINE_REL));
}, 120000);

afterAll(() => {
  if (SANDBOX) fs.rmSync(SANDBOX, { recursive: true, force: true });
});

/** Add a tracked file in the sandbox (the gate only sees tracked files). */
function addTracked(rel, contents) {
  const p = path.join(SANDBOX, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, contents);
  execFileSync('git', ['add', rel], { cwd: SANDBOX });
  return p;
}

function removeTracked(rel) {
  execFileSync('git', ['rm', '-q', '-f', rel], { cwd: SANDBOX });
}

describe('check-env-access.py — detection semantics', () => {
  test('self-test passes', () => {
    const r = run(['--self-test']);
    expect(r.stdout).toMatch(/self-test: \d+\/\d+ passed/);
    expect(r.stdout).not.toMatch(/FAIL/);
    expect(r.exitCode).toBe(0);
  });

  test('a dynamic process.env[expr] read is captured, not silently missed', () => {
    // A computed key would otherwise be a hole big enough to drive anything
    // through: the variable name is unknowable statically.
    const r = run(['--self-test']);
    expect(r.stdout).toMatch(/ok +dynamic read detected/);
    expect(r.stdout).toMatch(/ok +dynamic with space detected/);
  });
});

describe('check-env-access.py — against the real tree', () => {
  test('the committed baseline matches reality exactly', () => {
    const r = run();
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/match the baseline exactly/);
  });

  test('reports how many direct reads remain, so progress is visible', () => {
    const r = run();
    expect(r.stdout).toMatch(/Direct env reads: \d+ references across \d+ files/);
  });

  test('src/lib/env.ts is exempt and therefore absent from the baseline', () => {
    // The resolver reading process.env is the point; baselining it would imply
    // it should eventually stop.
    const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, BASELINE_REL), 'utf-8'));
    expect(Object.keys(baseline.allowed)).not.toContain(SRC.libEnv);
  });

  test('--show emits a valid baseline shape, so one can be regenerated', () => {
    const r = run(['--show']);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed).toHaveProperty('allowed');
    expect(Object.keys(parsed.allowed).length).toBeGreaterThan(0);
  });
});

describe('check-env-access.py — the ratchet, in all four directions', () => {
  test('a NEW file reading process.env fails and names the variable', () => {
    addTracked('src/lib/__probe_new.ts', 'export const x = process.env.BRAND_NEW_VAR;\n');
    try {
      const r = runAt(SANDBOX_SCRIPT, [], SANDBOX);
      expect(r.exitCode).toBe(1);
      expect(r.stdout).toMatch(/NEW direct `process\.env` read/);
      expect(r.stdout).toMatch(/BRAND_NEW_VAR/);
      expect(r.stdout).toMatch(/src\/lib\/env\.ts instead/);
    } finally {
      removeTracked('src/lib/__probe_new.ts');
    }
  });

  test('a known-bad file reading MORE fails — may shrink, never grow', () => {
    const rel = SRC.turnstile;
    const p = path.join(SANDBOX, rel);
    const original = fs.readFileSync(p, 'utf-8');
    try {
      fs.writeFileSync(p, `${original}\nconst sneaky = process.env.SOME_NEW_THING;\n`);
      const r = runAt(SANDBOX_SCRIPT, [], SANDBOX);
      expect(r.exitCode).toBe(1);
      expect(r.stdout).toMatch(/now reads MORE/);
      expect(r.stdout).toMatch(/SOME_NEW_THING/);
    } finally {
      fs.writeFileSync(p, original);
    }
  });

  test('a MIGRATED file fails until its baseline entry is deleted', () => {
    // This is the direction that turns a suppression list into a ratchet. If it
    // ever goes green, the baseline can permanently over-state the problem.
    const rel = SRC.turnstile;
    const p = path.join(SANDBOX, rel);
    const original = fs.readFileSync(p, 'utf-8');
    try {
      fs.writeFileSync(p, original.replace(/process\.env\./g, 'env.'));
      const r = runAt(SANDBOX_SCRIPT, [], SANDBOX);
      expect(r.exitCode).toBe(1);
      expect(r.stdout).toMatch(/no longer reads `process\.env` — it was migrated/);
      expect(r.stdout).toMatch(/keeps shrinking/);
    } finally {
      fs.writeFileSync(p, original);
    }
  });

  test('a stale baselined VARIABLE fails too, not just a stale file', () => {
    const rel = SRC.twilio;
    const p = path.join(SANDBOX, rel);
    const original = fs.readFileSync(p, 'utf-8');
    const baseline = JSON.parse(
      fs.readFileSync(path.join(SANDBOX, BASELINE_REL), 'utf-8'),
    );
    const listed = baseline.allowed[rel];
    expect(Array.isArray(listed) && listed.length > 1).toBe(true);
    try {
      // Drop exactly one of its variables, keep the rest.
      fs.writeFileSync(p, original.replace(`process.env.${listed[0]}`, `env.${listed[0]}`));
      const r = runAt(SANDBOX_SCRIPT, [], SANDBOX);
      expect(r.exitCode).toBe(1);
      expect(r.stdout).toMatch(/no longer read/);
      expect(r.stdout).toMatch(new RegExp(listed[0]));
    } finally {
      fs.writeFileSync(p, original);
    }
  });
});

describe('check-env-access.py — escape hatch', () => {
  test('a valid hatch suppresses the read', () => {
    addTracked(
      'src/lib/__probe_hatch.ts',
      'export const x = process.env.BOOTSTRAP_ONLY; // env-access-ok: KAN-414 fixture\n',
    );
    try {
      const r = runAt(SANDBOX_SCRIPT, [], SANDBOX);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/Active env-access-ok exceptions \(1\)/);
      expect(r.stdout).toMatch(/\[KAN-414\]/);
    } finally {
      removeTracked('src/lib/__probe_hatch.ts');
    }
  });

  test('a hatch on the line ABOVE also works', () => {
    addTracked(
      'src/lib/__probe_hatch2.ts',
      '// env-access-ok: KAN-414 fixture above\nexport const x = process.env.BOOTSTRAP_ONLY;\n',
    );
    try {
      const r = runAt(SANDBOX_SCRIPT, [], SANDBOX);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/Active env-access-ok exceptions/);
    } finally {
      removeTracked('src/lib/__probe_hatch2.ts');
    }
  });

  test('a hatch WITHOUT a Jira key does NOT suppress', () => {
    addTracked(
      'src/lib/__probe_nokey.ts',
      'export const x = process.env.UNKEYED; // env-access-ok: no key here\n',
    );
    try {
      const r = runAt(SANDBOX_SCRIPT, [], SANDBOX);
      expect(r.exitCode).toBe(1);
      expect(r.stdout).toMatch(/UNKEYED/);
    } finally {
      removeTracked('src/lib/__probe_nokey.ts');
    }
  });
});

describe('check-env-access.py — fail-closed', () => {
  test('a missing baseline exits 2, not 0 and not 1', () => {
    const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'env-access-fc-'));
    try {
      execFileSync('git', ['clone', '--local', '--quiet', ROOT, sb], { stdio: 'ignore' });
      const script = path.join(sb, SCRIPT_REL);
      fs.copyFileSync(SCRIPT, script);
      // Delete it EXPLICITLY. An earlier version relied on simply not copying
      // it in, which passed only while the baseline was still untracked — once
      // committed, `git clone` brings it along and the case silently inverted.
      // CI caught it; the lesson is that "absent because I did not add it" and
      // "absent because I removed it" are different assertions.
      fs.rmSync(path.join(sb, BASELINE_REL), { force: true });
      const r = runAt(script, [], sb);
      expect(r.exitCode).toBe(2);
      expect(r.exitCode).not.toBe(0);
      expect(r.exitCode).not.toBe(1);
      expect(r.stdout).toMatch(/Failing closed/);
    } finally {
      fs.rmSync(sb, { recursive: true, force: true });
    }
  }, 120000);

  test('an unparseable baseline exits 2', () => {
    const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'env-access-bad-'));
    try {
      execFileSync('git', ['clone', '--local', '--quiet', ROOT, sb], { stdio: 'ignore' });
      const script = path.join(sb, SCRIPT_REL);
      fs.copyFileSync(SCRIPT, script);
      fs.writeFileSync(path.join(sb, BASELINE_REL), '{ not json');
      const r = runAt(script, [], sb);
      expect(r.exitCode).toBe(2);
      expect(r.stdout).toMatch(/not valid JSON/);
    } finally {
      fs.rmSync(sb, { recursive: true, force: true });
    }
  }, 120000);
});
