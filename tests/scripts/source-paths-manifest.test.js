/**
 * KAN-414 F4 / KAN-417 §3 — guards for the test path manifest.
 *
 * Two jobs:
 *   1. Every manifest entry points at something that exists. A manifest whose
 *      promise is "this path is real" is worthless the moment one isn't.
 *   2. The count of RAW repo-path literals still in tests/ may only shrink.
 *
 * Rule 2 is the ratchet, and it fails in BOTH directions on purpose — a rise
 * means new coupling was added, a fall without updating the baseline means the
 * baseline over-states the remaining work. A number that may only grow is a
 * progress bar that never moves; one that must be kept honest is a plan.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const MANIFEST_JSON = path.join(ROOT, 'tests/support/source-paths.json');
const MANIFEST_TS = path.join(ROOT, 'tests/support/source-paths.ts');
const BASELINE = path.join(ROOT, 'tests/support/raw-path-literal-baseline.json');

const LITERAL_RE =
  /'((?:src|supabase|scripts|public|\.github)\/[A-Za-z0-9_./[\]()@-]+)'/g;

function trackedTestFiles() {
  return execFileSync('git', ['-C', ROOT, 'ls-files', 'tests'], {
    encoding: 'utf-8',
  })
    .split('\n')
    .filter((f) => f && /\.(ts|tsx|js|jsx|cjs|mjs)$/.test(f));
}

/** Raw literals outside the manifest itself, which is where they belong. */
function countRawLiterals() {
  let total = 0;
  const files = new Set();
  for (const rel of trackedTestFiles()) {
    if (rel.startsWith('tests/support/')) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
    } catch {
      continue;
    }
    const n = [...text.matchAll(LITERAL_RE)].length;
    if (n) {
      total += n;
      files.add(rel);
    }
  }
  return { total, files: files.size };
}

describe('test path manifest (KAN-414 F4)', () => {
  test('both the TS and the JSON mirror exist', () => {
    // The .cjs MCP tests and shell consumers read the JSON; if only one is
    // generated, half the estate silently keeps its raw literals.
    expect(fs.existsSync(MANIFEST_TS)).toBe(true);
    expect(fs.existsSync(MANIFEST_JSON)).toBe(true);
  });

  test('every manifest entry points at a path that exists', () => {
    const { SRC } = JSON.parse(fs.readFileSync(MANIFEST_JSON, 'utf-8'));
    const missing = Object.entries(SRC).filter(
      ([, p]) => !fs.existsSync(path.join(ROOT, p)),
    );
    expect(missing).toEqual([]);
  });

  test('the manifest is not empty', () => {
    // A generator bug that produced `{}` would make every consuming test
    // resolve `undefined` and fail with something unrelated to the real cause.
    const { SRC } = JSON.parse(fs.readFileSync(MANIFEST_JSON, 'utf-8'));
    expect(Object.keys(SRC).length).toBeGreaterThan(50);
  });

  test('the TS and JSON mirrors agree exactly', () => {
    const { SRC } = JSON.parse(fs.readFileSync(MANIFEST_JSON, 'utf-8'));
    const ts = fs.readFileSync(MANIFEST_TS, 'utf-8');
    for (const [name, p] of Object.entries(SRC)) {
      expect(ts).toContain(`${name}: '${p}',`);
    }
  });

  test('the committed manifest is up to date with the tree', () => {
    // Catches "someone added a test with a new literal and did not regenerate".
    //
    // Note this file routes the generator's own path through the manifest
    // (`SRC.genTestPaths`) rather than hard-coding it. That is deliberate: the
    // ratchet counts raw literals, and a guard that exempted itself would be
    // asking everyone else to do something it would not. It is mildly
    // circular — a broken manifest breaks this test — but that is the failure
    // mode we want, not one we want to hide.
    const { SRC } = JSON.parse(fs.readFileSync(MANIFEST_JSON, 'utf-8'));
    const r = execFileSync('node', [SRC.genTestPaths, '--check'], {
      cwd: ROOT,
      encoding: 'utf-8',
    });
    expect(r).toMatch(/manifest is current/);
  });

  test('names are readable — no SCREAMING or single-letter identifiers', () => {
    // Generated ugliness is what makes people hand-edit generated files.
    const { SRC } = JSON.parse(fs.readFileSync(MANIFEST_JSON, 'utf-8'));
    for (const name of Object.keys(SRC)) {
      expect(name).toMatch(/^[a-z][A-Za-z0-9]*$/);
      expect(name.length).toBeGreaterThan(1);
    }
  });

  describe('the shrink-only ratchet on raw literals', () => {
    test('raw literal count has not RISEN above the baseline', () => {
      const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf-8'));
      const now = countRawLiterals();
      expect(now.total).toBeLessThanOrEqual(baseline.total_occurrences);
      expect(now.files).toBeLessThanOrEqual(baseline.files_with_raw_literals);
    });

    test('the baseline is not STALE — it must be lowered when literals are converted', () => {
      // The direction people forget. Without this, the baseline permanently
      // over-states the work left and nobody notices the day it is finished.
      const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf-8'));
      const now = countRawLiterals();
      expect(now.total).toBe(baseline.total_occurrences);
      expect(now.files).toBe(baseline.files_with_raw_literals);
    });
  });
});
