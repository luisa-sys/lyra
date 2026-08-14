/**
 * tests/scripts/check-dependency-rules.test.js — KAN-425 (Phase 0 / F3)
 *
 * Proves the dependency-rule gate actually gates. Each of the three rules gets a
 * fixture that MUST fail and a clean fixture that MUST pass — the house pattern
 * for the repo's guards, and the thing that makes the gate trustworthy: a control
 * that has never been seen to fail is indistinguishable from no control.
 *
 * Fixtures are throwaway trees cruised with the REAL .dependency-cruiser.cjs, so
 * a future edit that quietly weakens a rule turns one of these red.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SRC } = require('../support/source-paths.json');

const REPO_ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(REPO_ROOT, SRC.checkDependencyRules);
const CONFIG = path.join(REPO_ROOT, '.dependency-cruiser.cjs');

/**
 * Run the guard against `cwd` at the given severity. Returns { code, out }.
 * Fixtures are asserted in `error` mode so a violation surfaces as a non-zero
 * exit — `warn` mode is the roll-out dial, not the thing under test.
 */
function run(cwd, severity = 'error') {
  const env = {
    ...process.env,
    DEPCRUISE_SEVERITY: severity,
    DEPCRUISE_CONFIG: CONFIG,
    DEPCRUISE_TARGET: 'src',
    PATH: `${path.join(REPO_ROOT, 'node_modules/.bin')}:${process.env.PATH}`,
  };
  try {
    const out = execSync(`bash "${SCRIPT}"`, { stdio: 'pipe', cwd, env }).toString();
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

/** Build a throwaway source tree. `files` maps relative path -> contents. */
function makeTree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deprules-'));
  // dependency-cruiser resolves tsConfig.fileName relative to cwd.
  fs.writeFileSync(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } } })
  );
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  return dir;
}

// A tree with no violations: both segments depend only on themselves and on lib.
const CLEAN = {
  'src/lib/util.ts': 'export const util = 1;\n',
  'src/app/alpha/helper.ts': 'export const helper = 2;\n',
  'src/app/alpha/page.tsx':
    "import { util } from '../../lib/util';\nimport { helper } from './helper';\nexport default () => util + helper;\n",
  'src/app/beta/page.tsx': "import { util } from '../../lib/util';\nexport default () => util;\n",
};

describe('scripts/check-dependency-rules.sh (KAN-425)', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  const config = fs.readFileSync(CONFIG, 'utf8');

  it('exists, is bash, and is syntactically valid', () => {
    expect(fs.existsSync(SCRIPT)).toBe(true);
    expect(source.startsWith('#!/usr/bin/env bash')).toBe(true);
    expect(() => execSync(`bash -n "${SCRIPT}"`, { stdio: 'pipe' })).not.toThrow();
  });

  it('is hardened per the Workflow & Backup Integrity Policy', () => {
    expect(source).toMatch(/set -euo pipefail/);
    expect(source).not.toMatch(/\|\|\s*true/);
    expect(source).not.toMatch(/continue-on-error/);
    // No lossy "|| echo" placeholder that would mask a failed cruise as data.
    expect(source).not.toMatch(/npx[^\n]*\|\|\s*echo/);
  });

  it('defines exactly the three KAN-425 rules and none of the deferred six', () => {
    expect(config).toMatch(/name: 'no-module-to-app'/);
    expect(config).toMatch(/no-cross-segment-app\/\$\{segment\}/);
    expect(config).toMatch(/name: 'no-circular'/);
    // Scope discipline: these belong to KAN-415 C2 and need modules.json.
    for (const deferred of [
      'no-deep-module-import',
      'no-undeclared-module-dep',
      'app-routes-are-thin',
      'platform-is-a-leaf',
      'edge-safe',
      'backoffice-not-in-request-path',
    ]) {
      expect(config).not.toMatch(new RegExp(`name: ['"\`]${deferred}`));
    }
  });

  it('PASSES (exit 0) on a clean tree, even at blocking severity', () => {
    const { code, out } = run(makeTree(CLEAN));
    expect(code).toBe(0);
    expect(out).toMatch(/No dependency-rule violations/);
  });

  it('FAILS on no-module-to-app: src/lib importing src/app', () => {
    const { code, out } = run(
      makeTree({ ...CLEAN, 'src/lib/leaky.ts': "export { helper } from '../app/alpha/helper';\n" })
    );
    expect(code).not.toBe(0);
    expect(out).toMatch(/no-module-to-app/);
  });

  it('FAILS on no-cross-segment-app: one app segment importing another', () => {
    const { code, out } = run(
      makeTree({
        ...CLEAN,
        'src/app/beta/page.tsx': "export { helper } from '../alpha/helper';\n",
      })
    );
    expect(code).not.toBe(0);
    expect(out).toMatch(/no-cross-segment-app\/beta/);
  });

  it('FAILS on no-circular: a two-module import cycle', () => {
    const { code, out } = run(
      makeTree({
        ...CLEAN,
        'src/app/alpha/a.ts': "import { b } from './b';\nexport const a = b;\n",
        'src/app/alpha/b.ts': "import { a } from './a';\nexport const b = a;\n",
      })
    );
    expect(code).not.toBe(0);
    expect(out).toMatch(/no-circular/);
  });

  /**
   * Regression fixture for the defect this gate was born with (SEC-101 (a):
   * a control that missed gets a fixture reproducing the miss).
   *
   * The obvious single-rule form used a `$1` backreference, which
   * dependency-cruiser interpolates as RAW regex source. Next.js segment names
   * contain regex metacharacters — `[slug]` became a character class, `(auth)` a
   * capture group — so every SAME-segment import inside them was reported as a
   * cross-segment violation. 15 of the first run's 20 "violations" were false.
   * A gate that cries wolf gets switched off, so this must stay green.
   */
  it('does NOT false-positive inside segments whose names contain regex metacharacters', () => {
    const { code, out } = run(
      makeTree({
        'src/lib/util.ts': 'export const util = 1;\n',
        [SRC.slugUtils]: 'export const slugUtil = 1;\n',
        [SRC.slugPage]:
          "import { slugUtil } from './slug-utils';\nexport default () => slugUtil;\n",
        [SRC.authErrors]: 'export const authError = 1;\n',
        [SRC.loginPage]:
          "import { authError } from '../auth-errors';\nexport default () => authError;\n",
      })
    );
    expect(code).toBe(0);
    expect(out).toMatch(/No dependency-rule violations/);
  });

  it('FAILS CLOSED when the config is missing', () => {
    const dir = makeTree(CLEAN);
    const { code, out } = (() => {
      try {
        const o = execSync(`bash "${SCRIPT}"`, {
          stdio: 'pipe',
          cwd: dir,
          env: { ...process.env, DEPCRUISE_CONFIG: path.join(dir, 'absent.cjs') },
        }).toString();
        return { code: 0, out: o };
      } catch (e) {
        return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
      }
    })();
    expect(code).not.toBe(0);
    expect(out).toMatch(/failing closed|cannot run/i);
  });

  it('FAILS CLOSED on an unrecognised severity rather than defaulting to permissive', () => {
    const { code, out } = run(makeTree(CLEAN), 'off');
    expect(code).not.toBe(0);
    expect(out).toMatch(/DEPCRUISE_SEVERITY must be/);
  });
});

// ── KAN-414 F3: per-rule severity ─────────────────────────────────────────────
// A single global dial made the whole gate hostage to its worst rule. These pin
// which rules are BLOCKING so nobody can quietly demote one back to `warn` to
// get a red build green — the demotion, not the violation, is the regression.
describe('per-rule severity (KAN-414 F3)', () => {
  const cfg = require('node:fs').readFileSync(
    require('node:path').resolve(__dirname, '../../.dependency-cruiser.cjs'),
    'utf-8',
  );

  test('no-module-to-app is blocking', () => {
    expect(cfg).toMatch(/name: 'no-module-to-app',\s*\n\s*severity: severityFor\(BLOCKING\)/);
  });

  test('no-circular is blocking', () => {
    expect(cfg).toMatch(/name: 'no-circular',\s*\n\s*severity: severityFor\(BLOCKING\)/);
  });

  test('no-cross-segment-app is NOW blocking too — KAN-415 cleared its last edge', () => {
    // Was deliberately NOT blocking while 3 of its 4 violations belonged to D8
    // and KAN-422 and the 4th was unrouted. All four are cleared, so the
    // demotion this test guards against is now a demotion from error.
    expect(cfg).toMatch(
      /no-cross-segment-app\/\$\{segment\}`,\s*\n\s*severity: severityFor\(BLOCKING\)/,
    );
  });

  test('the reason each rule sits where it does is written down', () => {
    // A severity with no recorded justification is the thing that rots. Assert
    // the owners are NAMED, without pinning comment line-wrapping.
    // Strip leading comment asterisks before collapsing whitespace, or a
    // wrapped sentence reads as "D8's * acceptance criteria".
    const prose = cfg.replace(/^\s*\*\s?/gm, '').replace(/\s+/g, ' ');
    expect(prose).toMatch(/no-module-to-app 0 violations/);
    // How each cross-segment edge was cleared, still named rather than merely
    // declared gone — a rule that reaches zero with no record of HOW is one
    // nobody can safely re-open.
    expect(prose).toMatch(/cleared by D8/);
    expect(prose).toMatch(/PRIVATE folder/);
    expect(prose).toMatch(/session-actions\.ts/);
  });

  test('DEPCRUISE_SEVERITY=error still forces every rule to error', () => {
    // The dial moved into scripts/depcruise-severity.cjs when the last rule
    // flipped — see that file's header. Assert it where it now lives, or this
    // passes against a config that no longer contains the mechanism at all.
    const { SRC } = require('../support/source-paths.json');
    const dial = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../..', SRC.depcruiseSeverity),
      'utf-8',
    );
    expect(dial).toMatch(/forceError \|\| ruleAtZero/);
    expect(cfg).toMatch(/require\('\.\/scripts\/depcruise-severity\.cjs'\)/);
  });
});
