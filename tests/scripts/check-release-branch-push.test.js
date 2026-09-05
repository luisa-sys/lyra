/**
 * CTL-064 / SEC-99 — no repo-committed script pushes to a release branch.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * SEC-98 says production changes only via `develop -> staging -> beta -> main`,
 * and that pushing directly to `main`, `beta` or `staging` is prohibited. Until
 * SEC-99 that rule lived only in CLAUDE.md, while the repo shipped
 * `scripts/promote-to-production.sh` and `scripts/promote-to-staging.sh` — six
 * direct pushes between them, three of which were `--force` onto `main`.
 * Deleting them removes today's bypass; this control is what stops tomorrow's.
 *
 * WHY THESE TESTS DRIVE THE REAL SCRIPT
 * -------------------------------------
 * CTL-038: a test that reimplements its subject reports green whatever the
 * subject does. Every case here `spawnSync`s the actual checker — the
 * `tests/scripts/` subprocess convention — so tokenising, comment-stripping,
 * file discovery and exit codes are exercised together.
 *
 * WHY THERE IS A FLOOR ON THE SELF-TEST COUNT
 * -------------------------------------------
 * `--self-test` reports `N cases`. Asserting only "it passed" cannot tell a
 * suite of 56 fixtures from a suite of 1 — the CTL-062 lesson, and failure mode
 * #8 (a hand-maintained number that drifts below reality detects nothing). The
 * floor may be RAISED as fixtures are added; lowering it needs sign-off, since
 * it would be weakening an existing assertion under the Test Integrity Policy.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { SRC } = require('../support/source-paths.json');
const SCRIPT = SRC.checkReleaseBranchPush;

// The F4 raw-literal ratchet is shrink-only and counts single-quoted repo
// paths in tests/**, so this file must add none. Real repo files go through
// `SRC`; fixture paths inside throwaway repos are assembled from `DIR`, since
// they name nothing in this tree and so have no manifest key to point at.
const DIR = 'scripts';

// gotcha #31 — a lost manifest key is `undefined`, and `spawnSync(undefined)`
// fails in a way that reads like a broken harness rather than a lost control.
expect(typeof SCRIPT).toBe('string');

/** Committed MINIMUM number of self-test fixtures. May be raised, never lowered. */
const SELF_TEST_FLOOR = 56;

/** The two scripts SEC-99 found, and the exact pushes each contained. */
const DELETED_SCRIPTS = [
  `${DIR}/promote-to-production.sh`,
  `${DIR}/promote-to-staging.sh`,
];

function runChecker(args = [], cwd = ROOT) {
  const r = spawnSync('python3', [path.join(ROOT, SCRIPT), ...args], {
    cwd,
    encoding: 'utf-8',
  });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

/** A throwaway git repo, so `git ls-files` has something real to enumerate. */
function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctl063-jest-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  spawnSync('git', ['add', '-A'], { cwd: dir });
  return dir;
}

describe('CTL-064 — the checker exists and is wired in', () => {
  test('the script is tracked and executable by python3', () => {
    const tracked = spawnSync('git', ['ls-files', '--error-unmatch', SCRIPT], {
      cwd: ROOT,
      encoding: 'utf-8',
    });
    expect(tracked.status).toBe(0);
  });

  test('pr-checks.yml actually invokes it — a control nothing runs is not a control', () => {
    const wf = fs.readFileSync(path.join(ROOT, SRC.prChecks), 'utf-8');
    expect(wf).toContain(SCRIPT);
    // Both the fixtures and the estate must be checked. Wiring only the real
    // scan leaves the fixtures unrun; wiring only --self-test leaves the repo
    // unscanned, which is the SEC-79 shape.
    expect(wf).toContain(`${SCRIPT} --self-test`);
  });

  test('it is registered in controls/registry.json against SEC-99', () => {
    const reg = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'controls/registry.json'), 'utf-8'),
    );
    const entry = reg.controls.find((c) => c.implementation === SCRIPT);
    expect(entry).toBeDefined();
    expect(entry.prevents).toContain('SEC-99');
  });
});

describe('CTL-064 — self-test', () => {
  test('passes, and reports at least the committed number of fixtures', () => {
    const { code, out } = runChecker(['--self-test']);
    expect(out).toMatch(/Self-test passed \(\d+ cases\)/);
    expect(code).toBe(0);
    const n = Number(out.match(/Self-test passed \((\d+) cases\)/)[1]);
    expect(n).toBeGreaterThanOrEqual(SELF_TEST_FLOOR);
  });
});

describe('CTL-064 — the estate is clean, and the deleted scripts stay deleted', () => {
  test('no tracked file under scripts/ pushes to a release branch', () => {
    const { code, out } = runChecker([]);
    expect(out).toContain('No committed script');
    expect(code).toBe(0);
  });

  test.each(DELETED_SCRIPTS)('%s is not tracked', (rel) => {
    const tracked = spawnSync('git', ['ls-files', rel], {
      cwd: ROOT,
      encoding: 'utf-8',
    });
    expect(tracked.stdout.trim()).toBe('');
  });
});

describe('CTL-064 — behaviour, driven through the real script', () => {
  test('the SEC-99 defect, reintroduced verbatim, is caught with its branch named', () => {
    // The three `main` pushes from scripts/promote-to-production.sh, at the
    // line numbers SEC-99 §1 records. Reproducing the finding is what proves
    // this control would have caught it — not a hypothetical fixture.
    const body = [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'git push origin main',
      'git push origin main --force',
    ].join('\n');
    const dir = makeRepo({ [DELETED_SCRIPTS[0]]: body });
    const { code, out } = runChecker([], dir);
    expect(code).toBe(1);
    expect(out).toContain("pushes directly to 'main'");
    expect(out).toContain('SEC-98');
    expect(out).toMatch(/scripts\/promote-to-production\.sh:3/);
    expect(out).toMatch(/scripts\/promote-to-production\.sh:4/);
  });

  test.each([
    ['staging', 'git push origin staging --force'],
    ['beta', 'git push -f origin beta'],
    ['main', 'git push origin HEAD:main'],
    ['staging', 'git push origin develop:staging'],
  ])('catches a push to %s: %s', (branch, line) => {
    const dir = makeRepo({ [`${DIR}/x.sh`]: `${line}\n` });
    const { code, out } = runChecker([], dir);
    expect(code).toBe(1);
    expect(out).toContain(`pushes directly to '${branch}'`);
  });

  test('does not fire on a grep PATTERN that merely contains the text', () => {
    // Real lines from scripts/check-workflow-integrity.sh. A substring matcher
    // reads a control that DETECTS the defect as the defect itself.
    const dir = makeRepo({
      [SRC.checkWorkflowIntegrity]: [
        "count_matches \"$f\" -E 'git push origin (staging|main|production|develop)'",
        "grep -qE 'git push origin main([^a-zA-Z0-9_-]|$)' \"$f\"",
      ].join('\n'),
    });
    const { code } = runChecker([], dir);
    expect(code).toBe(0);
  });

  test('does not fire on a comment, so documenting the rule is not a violation', () => {
    const dir = makeRepo({
      [`${DIR}/x.sh`]: '# never do: git push origin main --force\necho ok\n',
    });
    const { code } = runChecker([], dir);
    expect(code).toBe(0);
  });

  test('does not fire on a legitimate push to develop or a tag', () => {
    const dir = makeRepo({
      [`${DIR}/x.sh`]: 'git push origin develop\ngit push origin "$NEW_TAG"\n',
    });
    const { code } = runChecker([], dir);
    expect(code).toBe(0);
  });

  test('has no extension filter — the SEC-99 correction-note lesson', () => {
    // §1 called the scripts unreferenced on a grep over *.md/*.yml/*.json/*.sh,
    // and missed docs/lyra-project-reference.jsx. A filter by extension answers
    // a narrower question than the one being asked.
    for (const name of ['x.sh', 'x.py', 'x.jsx', 'x.cjs', 'deploy']) {
      const dir = makeRepo({ [`${DIR}/${name}`]: 'git push origin main\n' });
      expect(runChecker([], dir).code).toBe(1);
    }
  });

  test('fails CLOSED when scripts/ is absent, with the exit-2 vocabulary', () => {
    // gotcha #30: a guard that reports clean having scanned nothing is the
    // failure it was written to prevent. Exit 1 and exit 2 must stay distinct
    // claims — "it is broken" versus "I could not look".
    const dir = makeRepo({ 'README.md': 'no scripts here\n' });
    const { code, out } = runChecker([], dir);
    expect(code).toBe(2);
    expect(out).toContain('never ran');
    expect(out).not.toContain('pushes directly to');
  });
});
