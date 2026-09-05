/**
 * CTL-065 — production deploy drift (SEC-153).
 *
 * Drives the REAL script as a subprocess rather than reimplementing any of its
 * logic (CTL-038 / gotcha #29). The script's own `--self-test` carries the
 * fixture cases over `classify()`; this suite asserts the things that live
 * OUTSIDE that function and would otherwise be unguarded:
 *
 *   - the self-test actually runs, passes, and reports a non-zero case count
 *     (an empty harness is green, catalogue failure mode 4);
 *   - the fail-closed contract holds end-to-end at the process boundary — no
 *     token means exit 2 and the word-for-word refusal to report a clean zero,
 *     not exit 0 with `commits_behind=0`;
 *   - exit 2 and exit 1 stay DISTINCT, because "I could not check" and "I
 *     checked and it is bad" are different claims (the CTL-059 lesson);
 *   - the control is registered and wired, so it cannot become a file nobody
 *     invokes (the SEC-79 failure).
 */

const { execFileSync } = require('child_process');
const { readFileSync, existsSync } = require('fs');
const { resolve } = require('path');
const { SRC } = require('../support/source-paths.json');

const ROOT = resolve(__dirname, '..', '..');
// Via SRC, not a raw literal: the F4 ratchet counts occurrences, and gotcha
// #31 means a lost key would surface as execFileSync(undefined).
const SCRIPT = resolve(ROOT, SRC.checkProductionDeployDrift);

function run(args = [], env = {}) {
  try {
    const stdout = execFileSync('python3', [SCRIPT, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status, stdout: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

describe('CTL-065 — the script exists and its self-test is real', () => {
  test('the script is present and executable as a module', () => {
    expect(existsSync(SCRIPT)).toBe(true);
  });

  test('--self-test passes and reports a NON-ZERO number of cases', () => {
    const { code, stdout } = run(['--self-test']);
    expect(code).toBe(0);
    expect(stdout).toMatch(/self-test passed/);
    // An empty harness is green. Assert the corpus is non-empty and pin the
    // count so silently deleting cases is a visible diff, not a quiet loss.
    const m = stdout.match(/self-test passed \((\d+) cases\)/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeGreaterThanOrEqual(12);
  });
});

describe('CTL-065 — fail-closed at the process boundary', () => {
  test('no GITHUB_TOKEN yields exit 2, not a clean zero', () => {
    const { code, stdout } = run([], { GITHUB_TOKEN: '' });
    expect(code).toBe(2);
    expect(stdout).toMatch(/status=unknown/);
    expect(stdout).toMatch(/DATA_UNAVAILABLE/);
  });

  test('the unverifiable path never prints a zero drift figure', () => {
    // The specific failure this guards: reporting `commits_behind=0` for a
    // question that was never answered. That reads identically to "up to date".
    const { stdout } = run([], { GITHUB_TOKEN: '' });
    expect(stdout).not.toMatch(/commits_behind=0\b/);
    expect(stdout).not.toMatch(/status=green/);
  });

  test('exit 2 (could not check) is distinct from exit 1 (checked, drifted)', () => {
    // Pinned so a future refactor cannot collapse them into one code. The two
    // sentences a reader draws from them are not interchangeable.
    const unverifiable = run([], { GITHUB_TOKEN: '' });
    expect(unverifiable.code).toBe(2);
    expect(unverifiable.code).not.toBe(1);
  });
});

describe('CTL-065 — registered and wired (SEC-79: a control nothing invokes is not a control)', () => {
  const registry = JSON.parse(readFileSync(resolve(ROOT, 'controls/registry.json'), 'utf8'));
  const entry = registry.controls.find((c) => c.id === 'CTL-065');

  test('CTL-065 is in the control registry', () => {
    expect(entry).toBeDefined();
  });

  test('its implementation path resolves to the real file', () => {
    expect(entry.implementation).toBe(SRC.checkProductionDeployDrift);
    expect(existsSync(resolve(ROOT, entry.implementation))).toBe(true);
  });

  test('it names SEC-153 in prevents', () => {
    expect(entry.prevents).toContain('SEC-153');
  });

  test('every workflow it claims to be wired into actually invokes it', () => {
    expect(entry.wired_in.length).toBeGreaterThan(0);
    for (const wf of entry.wired_in) {
      const body = readFileSync(resolve(ROOT, wf), 'utf8');
      expect(body).toContain(SRC.checkProductionDeployDrift.split('/').pop());
    }
  });
});
