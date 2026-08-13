/**
 * CTL-051 / KAN-415 C2 — the layering half.
 *
 * WHY THIS EXISTS
 * ---------------
 * `modules.json` declared a complete layered architecture — a `layer` per
 * module, a `mayDependOn`, a `mustNot`, and an explicit `layerPolicy` saying
 * upward edges are "FORBIDDEN ABSOLUTELY" — and *nothing read any of it*. All
 * 21 modules carried `"enforced": false`, and no script or test consumed that
 * field. The manifest described an architecture rather than constraining one.
 *
 * Measured when CTL-051 landed: 62 cross-module edges, 12 violating.
 *
 * These tests reach the REAL script by subprocess (CTL-038); a private copy of
 * the classification would keep passing while the shipped one drifted, which is
 * the failure this whole control is about.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { SRC } = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../support/source-paths.json'), 'utf-8'),
);
const SCRIPT = SRC.checkModuleLayering;
// Root-level, so the generator does not harvest it into SRC (it only takes
// src|supabase|scripts|public|design|.github prefixes) — and for the same
// reason the shrink-only raw-literal ratchet does not count it. Same case as
// controls/registry.json below.
const BASELINE = 'modules-layering-baseline.json';

function run(args) {
  try {
    return {
      code: 0,
      out: execFileSync('python3', [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf-8' }),
    };
  } catch (err) {
    return { code: err.status, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

let dir;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctl051-'));
});
afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A depcruise-shaped graph from [source, resolved] pairs.
 *
 * Fixture paths come from `SRC`, not literals: the F4 raw-literal ratchet is
 * shrink-only, so spelling real paths here would raise a baseline that may not
 * be raised. It also means a future move updates the manifest rather than these
 * assertions.
 */
function graph(pairs, name) {
  const bySrc = new Map();
  for (const [s, d] of pairs) {
    if (!bySrc.has(s)) bySrc.set(s, []);
    bySrc.get(s).push({ resolved: d });
  }
  const p = path.join(dir, `${name}.json`);
  fs.writeFileSync(
    p,
    JSON.stringify({
      modules: [...bySrc].map(([source, dependencies]) => ({ source, dependencies })),
    }),
  );
  return p;
}

describe('CTL-051 — the checker itself', () => {
  test('its self-test passes and has not shrunk', () => {
    const { code, out } = run(['--self-test']);
    expect(`${code}: ${out.trim()}`).toContain('Self-test passed');
    expect(code).toBe(0);
    const n = Number(/Self-test passed \((\d+) cases\)/.exec(out)?.[1] ?? 0);
    expect(n).toBeGreaterThanOrEqual(16);
  });

  test.each([
    ['a non-JSON graph', '<html>gateway timeout</html>'],
    ['a graph with no modules list', '{"summary":{}}'],
    ['an EMPTY module list', '{"modules":[]}'],
  ])('%s fails CLOSED rather than reporting clean', (label, body) => {
    const p = path.join(dir, `bad-${label.replace(/\W+/g, '-')}.json`);
    fs.writeFileSync(p, body);
    const { code, out } = run(['--graph', p]);
    // exit 2 = could not run, deliberately distinct from 1 = found violations.
    expect(`${label} -> ${code}`).toBe(`${label} -> 2`);
    expect(out).toContain('::error::');
  });

  test('an empty graph is a failure, not a clean sweep', () => {
    // The sharpest version of the SEC-136 shape: zero modules examined would
    // otherwise produce "0 violations" and a green tick.
    const p = path.join(dir, 'empty.json');
    fs.writeFileSync(p, '{"modules":[]}');
    const { out } = run(['--graph', p]);
    expect(out).toMatch(/EMPTY/);
    expect(out).not.toMatch(/✓/);
  });
});

describe('CTL-051 — it enforces the policy modules.json declares', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules.json'), 'utf-8'));
  const layers = Object.fromEntries(
    Object.entries(manifest.modules).map(([n, m]) => [n, m.layer]),
  );

  test('the real tree matches its baseline', () => {
    const { code, out } = run([]);
    expect(`exit ${code}\n${out}`).toContain('Layering matches the baseline');
    expect(code).toBe(0);
  });

  test('a NEW upward edge fails, and is reported as upward', () => {
    // platform is layer 0; anything importing "up" from it is the starkest
    // possible violation and the one no declaration may legalise.
    expect(layers.platform).toBe(0);
    expect(layers.dashboard).toBeGreaterThan(0);
    const p = graph([[SRC.platformEnv, SRC.dismissal]], 'upward');
    const { code, out } = run(['--graph', p]);
    expect(out).toMatch(/NEW\s+platform -> dashboard/);
    expect(out).toMatch(/UPWARD/);
    expect(code).toBe(1);
  });

  test('`mustNot` is reported alongside the layer rule, not instead of it', () => {
    // The two are independent declarations of the same intent. If a layer is
    // ever renumbered, mustNot is what still catches the edge — so a violation
    // that breaks both must say both.
    expect(manifest.modules.platform.mustNot).toContain('dashboard');
    const p = graph([[SRC.platformEnv, SRC.dismissal]], 'both');
    const { out } = run(['--graph', p]);
    expect(out).toMatch(/mustNot/);
  });

  test('a legal downward edge does NOT fail — the gate must not always fire', () => {
    // A gate that fires on everything is one people learn to wave through.
    const p = graph([[SRC.dismissal, SRC.platformEnv]], 'downward');
    const { out } = run(['--graph', p]);
    expect(out).not.toMatch(/NEW\s+dashboard -> platform/);
  });
});

describe('CTL-051 — the baseline is a ratchet, not a suppression list', () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, BASELINE), 'utf-8'));

  test('it is non-empty and cites its ticket', () => {
    // Catalogue failure mode 4: conclusions drawn from an empty corpus.
    expect(Object.keys(baseline.violations).length).toBeGreaterThan(0);
    expect(baseline.ticket).toMatch(/^[A-Z]+-\d+$/);
  });

  test('it records the violations that motivated the control', () => {
    // Named, not counted — a count is satisfied by any 12 entries.
    for (const k of ['access -> admin', 'public-profile -> profile', 'trust-safety -> admin']) {
      expect(`baselined ${k}: ${k in baseline.violations}`).toBe(`baselined ${k}: true`);
    }
  });

  test('every baselined key names two real modules', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules.json'), 'utf-8'));
    for (const k of Object.keys(baseline.violations)) {
      const [from, to] = k.split(' -> ');
      expect(`${k} from-exists: ${from in manifest.modules}`).toBe(`${k} from-exists: true`);
      expect(`${k} to-exists: ${to in manifest.modules}`).toBe(`${k} to-exists: true`);
    }
  });
});

describe('CTL-051 — wired in, not merely written', () => {
  test('pr-checks runs the LIVE check, not only the self-test', () => {
    // SEC-79: a control nothing invokes is a file. And asserting only that the
    // script NAME appears would be satisfied by the --self-test line alone —
    // the mistake made on CTL-049's wiring test and caught by mutation.
    const wf = fs.readFileSync(path.join(ROOT, SRC.prChecks), 'utf-8');
    const live = wf
      .split('\n')
      .filter(
        (l) =>
          l.includes(`python3 ${SCRIPT}`) &&
          !l.includes('--self-test') &&
          !/^\s*echo\b/.test(l.trim()),
      );
    expect(`live invocations: ${live.length}`).toBe('live invocations: 1');
    expect(live[0]).not.toContain('--graph');
  });

  test('it is registered in the control registry', () => {
    const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'controls/registry.json'), 'utf-8'));
    const e = reg.controls.find((c) => c.id === 'CTL-051');
    expect(e).toBeDefined();
    expect(e.implementation).toBe(SCRIPT);
  });
});
