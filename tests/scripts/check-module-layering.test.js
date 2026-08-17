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
 * KAN-415 C2 rule 3 (`no-undeclared-module-dep`) followed. It exists because
 * rule 1 structurally cannot see a whole class of coupling: a DOWNWARD edge is
 * legal at every layer, so without a declaration check any module may quietly
 * acquire a dependency on any lower one. Of the 62 edges, 50 were declared in
 * `mayDependOn`, 9 sat in the pending-decision list and 3 were declared
 * nowhere.
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
    expect(n).toBeGreaterThanOrEqual(27);
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

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules.json'), 'utf-8'));
const layers = Object.fromEntries(Object.entries(manifest.modules).map(([n, m]) => [n, m.layer]));

describe('CTL-051 — it enforces the policy modules.json declares', () => {
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

  test('a downward edge NOT in mayDependOn fails — the gap rule 1 cannot see', () => {
    // observability (L1) sits BELOW dashboard (L3), so this edge is legal by
    // layer and rule 1 is blind to it by construction. Only rule 3 can see it.
    //
    // The fixture's preconditions are asserted rather than assumed: if
    // `observability` were ever added to dashboard's mayDependOn, or the
    // layers renumbered, this test would stop exercising rule 3 while still
    // passing. That is catalogue failure mode 5 — inputs that cannot reach the
    // code under test — and it is silent unless pinned here.
    expect(layers.observability).toBeLessThan(layers.dashboard);
    expect(manifest.modules.dashboard.mayDependOn).not.toContain('observability');
    expect(manifest.modules.dashboard.mayDependOnCandidatesPendingDecision ?? []).not.toContain(
      'observability',
    );
    expect(typeof SRC.metrics).toBe('string'); // gotcha #31: a lost key targets `undefined`

    const p = graph([[SRC.dismissal, SRC.metrics]], 'undeclared');
    const { out, code } = run(['--graph', p]);
    expect(out).toMatch(/NEW\s+dashboard -> observability/);
    expect(out).toMatch(/undeclared-dep|mayDependOn/);
    expect(code).toBe(1);
  });

  test('a pending-decision edge is a DISTINCT kind, not silent approval', () => {
    // 9 of the 12 baselined violations are edges modules.json itself records
    // as open questions. Collapsing them into "undeclared" would lose the only
    // signal separating "not decided" from "not noticed".
    const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, BASELINE), 'utf-8'));
    const kinds = Object.values(baseline.violations).flatMap((v) => v.kinds);
    expect(kinds).toContain('pending-decision');
    expect(kinds).toContain('undeclared-dep');
  });
});

describe('CTL-051 — the manifest is judged before the graph', () => {
  test('the shipped manifest is internally coherent', () => {
    // trust-safety.mayDependOn granted `admin` — an L3 -> L4 edge the same
    // file calls forbidden absolutely — while listing that identical edge as
    // an open question. A grant that can never be honoured still reads as
    // approval to anyone checking whether the dependency is allowed.
    const { code, out } = run([]);
    expect(`exit ${code}\n${out}`).not.toContain('contradicts itself');
    expect(code).toBe(0);
  });

  test('every mayDependOn grant is honourable under the layer rule', () => {
    // Asserted here as well as in the script, because this is the invariant
    // that makes `mayDependOn` meaningful at all: a grant the layer rule
    // overrides is not a permission, it is a comment.
    const same = new Set(
      (manifest.layerPolicy?.declaredSameLayer ?? []).map((e) => `${e.from} -> ${e.to}`),
    );
    const bad = [];
    for (const [name, mod] of Object.entries(manifest.modules)) {
      for (const t of mod.mayDependOn ?? []) {
        if (!(t in manifest.modules)) bad.push(`${name} -> ${t} (not a module)`);
        else if (layers[t] > layers[name]) bad.push(`${name} -> ${t} (upward)`);
        else if (layers[t] === layers[name] && !same.has(`${name} -> ${t}`)) {
          bad.push(`${name} -> ${t} (undeclared same-layer)`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  test('a contradiction cannot be laundered through --write-baseline', () => {
    // The escape hatch for a violation is the baseline. There must be no
    // escape hatch for an incoherent policy — otherwise the yardstick itself
    // becomes suppressible, which is strictly worse than a suppressed finding.
    const src = fs.readFileSync(path.join(ROOT, SCRIPT), 'utf-8');
    const contraIdx = src.indexOf('if bad := contradictions(manifest)');
    const writeIdx = src.indexOf('if args.write_baseline');
    expect(contraIdx).toBeGreaterThan(-1);
    expect(writeIdx).toBeGreaterThan(-1);
    expect(`contradiction check before --write-baseline: ${contraIdx < writeIdx}`).toBe(
      'contradiction check before --write-baseline: true',
    );
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
