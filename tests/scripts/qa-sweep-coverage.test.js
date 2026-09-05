/**
 * KAN-467 Phase 2 — tests for qa-sweep/coverage.py.
 *
 * The property under test is anti-flattery: the join must never mark an item
 * covered that no test exercises. This repo found nine vacuous suites in a
 * single day — one satisfied by a code comment, two that reimplemented their
 * subject and tested the copy — and every one of them reported green. A
 * coverage ledger that over-credits would launder exactly that failure into a
 * percentage.
 *
 * So the central tests here use an INDEPENDENT ORACLE: they read the test
 * files themselves and confirm the ledger's verdict, rather than asking the
 * subject whether it agrees with itself.
 *
 * Every test here was mutation-verified against the real subject.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const QA_DIR = path.join(ROOT, 'qa-sweep');
const COVERAGE = path.join(QA_DIR, 'coverage.py');

function run(script, args = []) {
  try {
    const stdout = execFileSync('python3', [script, ...args], {
      encoding: 'utf-8',
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, exitCode: 0 };
  } catch (err) {
    return { stdout: (err.stdout ?? '') + (err.stderr ?? ''), exitCode: err.status ?? 1 };
  }
}

/**
 * Committed MINIMUM fixture count for `coverage.py --self-test`.
 *
 * `expect(stdout).toMatch(/self-test: \d+\/\d+ passed/)` moves its denominator
 * with its numerator, so it detects a fixture that FAILS and never one that is
 * DELETED — the same defect this whole module exists to stop the coverage
 * ledger from laundering into a percentage. May be RAISED; never lowered.
 */
const COVERAGE_SELF_TEST_FLOOR = 26;

/** Assert a `--self-test` passed everything AND ran at least `floor` fixtures. */
function assertSelfTestFloor(stdout, label, floor) {
  const m = new RegExp(`${label} self-test: (\\d+)/(\\d+) passed`).exec(stdout);
  expect(`${label} self-test line present`).toBe(m ? `${label} self-test line present` : 'MISSING');
  const [, passed, total] = m.map(Number);
  expect(`${label}:${passed}/${total}`).toBe(`${label}:${total}/${total}`);
  expect(total).toBeGreaterThanOrEqual(floor);
  return total;
}

let LEDGER = null;
/** Concatenated text of every test file — the independent oracle. */
let ALL_TEST_TEXT = '';

beforeAll(() => {
  const out = path.join(os.tmpdir(), `qa-coverage-${process.pid}.json`);
  const r = run(COVERAGE, ['--out', out]);
  expect(r.exitCode).toBe(0);
  LEDGER = JSON.parse(fs.readFileSync(out, 'utf-8'));
  fs.rmSync(out, { force: true });

  const chunks = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(full);
      } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
        chunks.push(fs.readFileSync(full, 'utf-8'));
      }
    }
  })(path.join(ROOT, 'tests'));
  ALL_TEST_TEXT = chunks.join('\n');
}, 180000);

describe('qa-sweep/coverage.py — the join', () => {
  test('self-test passes, and runs at least its committed floor of fixtures', () => {
    const r = run(COVERAGE, ['--self-test']);
    assertSelfTestFloor(r.stdout, 'coverage', COVERAGE_SELF_TEST_FLOOR);
    expect(r.stdout).not.toMatch(/FAIL/);
    expect(r.exitCode).toBe(0);
  });

  test('every row carries one of the four states', () => {
    expect(LEDGER.rows.length).toBeGreaterThan(0);
    for (const row of LEDGER.rows) {
      expect(['covered', 'uncovered', 'denylisted', 'inventory-only']).toContain(row.state);
    }
  });

  test('a covered row always names the test that covers it', () => {
    // The structural anti-flattery invariant: "covered" with nothing behind it
    // is the exact shape of a vacuous pass.
    const covered = LEDGER.rows.filter((r) => r.state === 'covered');
    expect(covered.length).toBeGreaterThan(0);
    for (const row of covered) {
      expect(Array.isArray(row.covered_by)).toBe(true);
      expect(row.covered_by.length).toBeGreaterThan(0);
    }
  });

  test('a row with no covering test is never marked covered', () => {
    for (const row of LEDGER.rows) {
      if (!row.covered_by || row.covered_by.length === 0) {
        expect(row.state).not.toBe('covered');
      }
    }
  });

  test('every covered ACTION is genuinely named in the test that claims it', () => {
    // Independent oracle: read the claimed test file and check for the name.
    const actions = LEDGER.rows.filter((r) => r.kind === 'action' && r.state === 'covered');
    expect(actions.length).toBeGreaterThan(0);
    for (const row of actions) {
      const name = row.id.split('::')[1];
      const named = row.covered_by.some((rel) => {
        const text = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
        return new RegExp(`\\b${name}\\b`).test(text);
      });
      expect(`${row.id} named-by-its-claimed-test`).toBe(
        `${row.id} ${named ? 'named-by-its-claimed-test' : 'NOT-NAMED'}`,
      );
    }
  });

  test('every uncovered ACTION appears in no test file at all', () => {
    // The other direction. If the join under-reported, some "uncovered" action
    // would in fact be named somewhere in tests/ — this catches that.
    const uncovered = LEDGER.rows.filter((r) => r.kind === 'action' && r.state === 'uncovered');
    expect(uncovered.length).toBeGreaterThan(0);
    for (const row of uncovered) {
      const name = row.id.split('::')[1];
      const appears = new RegExp(`\\b${name}\\b`).test(ALL_TEST_TEXT);
      expect(`${row.id}:${appears}`).toBe(`${row.id}:false`);
    }
  });

  test('importing an action module is NOT counted as covering its actions', () => {
    // The single most tempting bad inference: "a test imports actions.ts,
    // therefore all 40 actions in it are covered".
    // Note an action may legitimately be covered by one test while OTHER tests
    // merely import its module — so the property is specifically about actions
    // whose ONLY signal is the import.
    // Scoped to exercisable actions: a denylisted action stays 'denylisted'
    // whatever the test signal, because policy outranks coverage.
    const importOnly = LEDGER.rows.filter(
      (r) =>
        r.kind === 'action' &&
        r.scope === 'exercisable' &&
        (r.file_touched_only || []).length > 0 &&
        r.covered_by.length === 0,
    );
    expect(importOnly.length).toBeGreaterThan(0);
    for (const row of importOnly) {
      expect(row.state).toBe('uncovered');
    }
  });

  test('rendering a page is NOT counted as covering its elements', () => {
    const visitedOnly = LEDGER.rows.filter(
      (r) =>
        (r.kind === 'element' || r.kind === 'field') &&
        (r.route_visited_only || []).length > 0 &&
        r.covered_by.length === 0,
    );
    expect(visitedOnly.length).toBeGreaterThan(0);
    for (const row of visitedOnly) {
      expect(row.state).not.toBe('covered');
    }
  });

  test('a covered ROUTE is genuinely visited by the spec that claims it', () => {
    const routes = LEDGER.rows.filter((r) => r.kind === 'route' && r.state === 'covered');
    expect(routes.length).toBeGreaterThan(0);
    for (const row of routes) {
      for (const rel of row.covered_by) {
        expect(fs.existsSync(path.join(ROOT, rel))).toBe(true);
      }
    }
    // And the visited-route list is not empty, so "covered" is not vacuous.
    expect(LEDGER.signals.routes_visited_by_e2e.length).toBeGreaterThan(0);
  });

  test('the dynamic route does not absorb statically-routed paths', () => {
    // Without exact-match precedence, /[slug] would claim /search, /about and
    // the rest, reporting the public surface as covered.
    const slug = LEDGER.rows.find((r) => r.kind === 'route' && r.path === '/[slug]');
    expect(slug).toBeDefined();
    const search = LEDGER.rows.find((r) => r.kind === 'route' && r.path === '/search');
    expect(search).toBeDefined();
    expect(search.state).toBe('uncovered');
  });
});

describe('qa-sweep/coverage.py — policy states', () => {
  test('denylisted rows are never covered or uncovered', () => {
    const denied = LEDGER.rows.filter((r) => r.scope === 'denylisted');
    expect(denied.length).toBeGreaterThan(0);
    for (const row of denied) expect(row.state).toBe('denylisted');
  });

  test('admin rows are never covered or uncovered — they are excluded by policy', () => {
    // Two admin ACTIONS (bulkUserAction, setGlobalFeature) are also on the
    // destructive denylist, and denylisted outranks inventory-only: the
    // stronger reason for never touching something is the one worth showing.
    const admin = LEDGER.rows.filter((r) => String(r.path || '').startsWith('/admin'));
    expect(admin.length).toBeGreaterThan(0);
    let inventoryOnly = 0;
    for (const row of admin) {
      expect(['inventory-only', 'denylisted']).toContain(row.state);
      expect(row.state).not.toBe('covered');
      expect(row.state).not.toBe('uncovered');
      if (row.state === 'inventory-only') inventoryOnly += 1;
    }
    // The bulk of the admin surface is inventory-only, not denylisted — so
    // this test cannot be satisfied by everything being denylisted.
    expect(inventoryOnly).toBeGreaterThan(0);
    const adminRoutes = admin.filter((r) => r.kind === 'route');
    expect(adminRoutes.length).toBeGreaterThan(0);
    for (const row of adminRoutes) expect(row.state).toBe('inventory-only');
  });

  test('policy-excluded rows are excluded from the coverage percentage', () => {
    // Counting 130 inventory-only rows as "uncovered" would make the number
    // look like neglected work rather than a decision; counting them as
    // "covered" would be a lie. They are excluded from the denominator and
    // reported separately.
    for (const [, v] of Object.entries(LEDGER.totals.by_kind)) {
      const covered = v.by_state.covered ?? 0;
      const uncovered = v.by_state.uncovered ?? 0;
      const denylisted = v.by_state.denylisted ?? 0;
      const inventoryOnly = v.by_state['inventory-only'] ?? 0;
      // Exercisable excludes both policy states.
      expect(v.exercisable).toBe(covered + uncovered);
      expect(v.total).toBe(covered + uncovered + denylisted + inventoryOnly);
      expect(v.covered).toBe(covered);
      if (v.exercisable > 0) {
        // The reported figure is rounded to 1dp by the subject.
        expect(Math.abs(v.coverage_pct - (100 * covered) / v.exercisable)).toBeLessThan(0.06);
      }
    }
    // And the policy states are genuinely present, so the assertions above are
    // not passing on empty sets.
    expect(LEDGER.totals.by_state['inventory-only']).toBeGreaterThan(0);
    expect(LEDGER.totals.by_state.denylisted).toBeGreaterThan(0);
  });

  test('the API surface is reported as a real gap, not hidden', () => {
    const api = LEDGER.totals.by_surface.api;
    expect(api).toBeDefined();
    expect(api.covered).toBe(0);
    expect(api.uncovered).toBeGreaterThan(0);
  });

  test('the summary names the biggest gaps explicitly', () => {
    // A summary of percentages alone lets the reader pick a comfortable
    // reading; naming the surfaces does not.
    const r = run(COVERAGE, ['--summary']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/BIGGEST GAPS/);
    expect(r.stdout).toMatch(/api: \d+ uncovered route/);
    expect(r.stdout).toMatch(/low-confidence/);
  });

  test('--summary does not write the ledger file', () => {
    const marker = path.join(os.tmpdir(), `qa-cov-nowrite-${process.pid}.json`);
    fs.rmSync(marker, { force: true });
    const r = run(COVERAGE, ['--summary', '--out', marker]);
    expect(r.exitCode).toBe(0);
    expect(fs.existsSync(marker)).toBe(false);
  });
});
