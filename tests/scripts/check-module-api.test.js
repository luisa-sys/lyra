/**
 * CTL-053 / KAN-415 C2 — `no-deep-module-import`.
 *
 * WHY THIS EXISTS
 * ---------------
 * CTL-051 constrains WHICH modules may depend on each other. It does nothing
 * about which FILES a permitted dependency may reach. Measured when this
 * landed: 304 files across 21 modules, of which only **54 are imported from
 * outside**. The other 250 were internals in fact and public in policy — any
 * of them could acquire an external consumer with nothing going red.
 *
 * That gap is the difference between a module and a directory.
 *
 * WHY NOT tsconfig ALIASES (plan §4.1, corrected by KAN-432)
 * ----------------------------------------------------------
 * An alias only governs imports WRITTEN in alias form. A relative specifier
 * (`../../modules/convene/internal/thing`) resolves and type-checks regardless.
 * Aliases catch the honest mistake and miss the shortcut. This reads the
 * resolved graph, which sees both, and needs no index.ts to exist — there are
 * none, and creating 21 plus their aliases would rewrite every import in the
 * app for enforcement this provides directly.
 *
 * These tests reach the REAL script by subprocess (CTL-038).
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { SRC } = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../support/source-paths.json'), 'utf-8'),
);
const SCRIPT = SRC.checkModuleApi;

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctl053-'));
});
afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

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

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules.json'), 'utf-8'));
const declaredOf = (m) => (manifest.modules[m].declaredApi ?? []).map((e) => e.file);
const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf-8' })
  .split('\n')
  .filter(Boolean);

describe('CTL-053 — the checker itself', () => {
  test('its self-test passes and has not shrunk', () => {
    const { code, out } = run(['--self-test']);
    expect(`${code}: ${out.trim()}`).toContain('Self-test passed');
    expect(code).toBe(0);
    const n = Number(/Self-test passed \((\d+) cases\)/.exec(out)?.[1] ?? 0);
    expect(n).toBeGreaterThanOrEqual(14);
  });

  test.each([
    ['a non-JSON graph', '<html>gateway timeout</html>'],
    ['a graph with no modules list', '{"summary":{}}'],
    ['an EMPTY module list', '{"modules":[]}'],
  ])('%s fails CLOSED rather than reporting clean', (label, body) => {
    const p = path.join(dir, `bad-${label.replace(/\W+/g, '-')}.json`);
    fs.writeFileSync(p, body);
    const { code, out } = run(['--graph', p]);
    expect(`${label} -> ${code}`).toBe(`${label} -> 2`);
    expect(out).toContain('::error::');
  });

  test('the real tree has no deep imports and no stale declarations', () => {
    const { code, out } = run([]);
    expect(`exit ${code}\n${out}`).toContain('lands on a declared entry point');
    expect(code).toBe(0);
  });
});

describe('CTL-053 — it distinguishes an entry point from an internal', () => {
  // Fixture paths deliberately avoid the `src/` prefix. The F4 raw-literal
  // ratchet is shrink-only and counts any `src/...` literal under tests/, so a
  // synthetic path that will never exist on disk would raise a baseline that
  // may not be raised. `owner_of` is prefix-agnostic, so the fixture is
  // unaffected.
  //
  // Fixtures supply their OWN manifest as well as their own graph. Judging a
  // single-edge fixture graph against the real 54-entry modules.json makes every
  // unrelated declaration read as stale — the test would then be asserting
  // something about modules.json rather than about the code under test. That is
  // how the first draft of these four tests failed.
  const fixtureManifest = () => {
    const p = path.join(dir, 'manifest.json');
    fs.writeFileSync(
      p,
      JSON.stringify({
        modules: {
          core: { paths: ['fixture-core/'], declaredApi: [{ file: 'fixture-core/api.ts' }] },
          consumer: { paths: ['fixture-consumer/'], declaredApi: [] },
        },
      }),
    );
    return p;
  };

  test('importing a DECLARED entry point is legal', () => {
    // A gate that fires on everything is one people learn to wave through.
    const { code, out } = run([
      '--graph', graph([['fixture-consumer/p.ts', 'fixture-core/api.ts']], 'legal'),
      '--manifest', fixtureManifest(),
    ]);
    expect(out).not.toMatch(/DEEP|STALE/);
    expect(code).toBe(0);
  });

  test('reaching past the declared surface is a DEEP import', () => {
    const { code, out } = run([
      '--graph', graph([['fixture-consumer/p.ts', 'fixture-core/internal.ts']], 'deep'),
      '--manifest', fixtureManifest(),
    ]);
    expect(out).toMatch(/DEEP/);
    expect(out).toContain('fixture-core/internal.ts');
    expect(out).toContain('consumer'); // names who reached in
    expect(code).toBe(1);
  });

  test('a module may reach its OWN internals freely', () => {
    // Encapsulation constrains outsiders, not the module itself. If this ever
    // inverted, every module would have to route through its own API.
    const { out } = run([
      '--graph', graph([
        ['fixture-core/other.ts', 'fixture-core/internal.ts'],
        ['fixture-consumer/p.ts', 'fixture-core/api.ts'],
      ], 'internal'),
      '--manifest', fixtureManifest(),
    ]);
    expect(out).not.toMatch(/DEEP|STALE/);
  });

  test('a declared entry nothing imports is STALE — the surface must shrink', () => {
    // Without this half, declaredApi could only ever grow, which is a
    // suppression list wearing a ratchet's clothes.
    const { code, out } = run([
      '--graph', graph([['fixture-core/a.ts', 'fixture-core/internal.ts']], 'stale'),
      '--manifest', fixtureManifest(),
    ]);
    expect(out).toMatch(/STALE/);
    expect(out).toContain('fixture-core/api.ts');
    expect(code).toBe(1);
  });

  test('the LIVE tree is what the real run judges — fixtures cannot mask it', () => {
    // The fixture seam exists for tests; the shipped invocation must use neither
    // flag, or the gate would be judging something other than this repo.
    const wf = fs.readFileSync(path.join(ROOT, SRC.prChecks), 'utf-8');
    const live = wf.split('\n').filter(
      (l) => l.includes(`python3 ${SCRIPT}`) && !l.includes('--self-test') && !/^\s*#/.test(l.trim()),
    );
    expect(live).toHaveLength(1);
    expect(live[0]).not.toMatch(/--graph|--manifest/);
  });
});

describe('CTL-053 — declaredApi is POLICY, and stays hand-edited', () => {
  test('the script has no --write mode', () => {
    // Regenerating policy from observation would mean the gate could never
    // fail: every deep import would legalise itself on the next run. `--suggest`
    // prints; a human commits.
    const src = fs.readFileSync(path.join(ROOT, SCRIPT), 'utf-8');
    expect(src).not.toMatch(/--write-declared|--write-baseline|--fix\b/);
    expect(src).toMatch(/--suggest/);
  });

  test('every declaredApi entry names a file that exists and belongs to that module', () => {
    // A declaration pointing at a moved or deleted file is the KAN-419 path-rot
    // failure: it protects nothing while CI stays green.
    const trackedSet = new Set(tracked);
    const bad = [];
    for (const [name, mod] of Object.entries(manifest.modules)) {
      for (const e of mod.declaredApi ?? []) {
        // Mirrors owner_of()'s rule exactly: a `paths` entry may name a
        // DIRECTORY or a single FILE. platform declares six individual files,
        // so a directory-only prefix test reports 19 false positives.
        const owns = (mod.paths ?? []).some((p) => {
          const q = p.replace(/\/$/, '');
          return e.file === q || e.file.startsWith(q + '/');
        });
        if (!trackedSet.has(e.file)) bad.push(`${name}: ${e.file} (not tracked)`);
        else if (!owns) bad.push(`${name}: ${e.file} (outside the module's own paths)`);
      }
    }
    expect(bad).toEqual([]);
  });

  test('the declared surface is a small fraction of the tree', () => {
    // The number that makes this control worth having. If it ever approaches
    // the file count, the modules have stopped encapsulating anything and that
    // is the finding, not a reason to relax the test.
    const declared = Object.values(manifest.modules).reduce(
      (n, m) => n + (m.declaredApi ?? []).length,
      0,
    );
    expect(declared).toBeGreaterThan(0);
    expect(declared).toBeLessThan(120);
  });

  test('audit’s aspirational symbols are OUT of the field the gate reads', () => {
    // They describe symbols that do not exist yet ("todayImplementedBy:
    // moderateAndAudit()"). Feeding intent to an enforcement gate makes its
    // input part-real, part-wish.
    const audit = manifest.modules.audit;
    expect(Array.isArray(audit.plannedApi)).toBe(true);
    expect(audit.plannedApi.length).toBeGreaterThan(0);
    for (const e of audit.declaredApi ?? []) expect(e).toHaveProperty('file');
  });
});

describe('CTL-053 — wired in, not merely written', () => {
  test('pr-checks runs the LIVE check, not only the self-test', () => {
    const wf = fs.readFileSync(path.join(ROOT, SRC.prChecks), 'utf-8');
    const live = wf
      .split('\n')
      .filter(
        (l) => l.includes(`python3 ${SCRIPT}`) && !l.includes('--self-test') && !/^\s*#/.test(l.trim()),
      );
    expect(`live invocations: ${live.length}`).toBe('live invocations: 1');
    expect(live[0]).not.toContain('--graph');
    expect(live[0]).not.toContain('--suggest');
  });

  test('it is registered in the control registry', () => {
    const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'controls/registry.json'), 'utf-8'));
    const e = reg.controls.find((c) => c.id === 'CTL-053');
    expect(e).toBeDefined();
    expect(e.implementation).toBe(SCRIPT);
  });
});
