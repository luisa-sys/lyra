/**
 * CTL-054 / KAN-415 C2 — `edge-safe`.
 *
 * WHY THIS EXISTS
 * ---------------
 * `src/middleware.ts` runs in the Edge runtime, which is not Node: no `fs`, no
 * `crypto` module, `next/headers` throws, and the full `@supabase/supabase-js`
 * client is the wrong one (`@supabase/ssr` is the Edge-safe path).
 *
 * The hazard is that **nothing in the import chain announces itself as edge
 * code**. `src/modules/access/gates/suspension.ts` looks like any other module
 * file. Add a `node:crypto` import to something it transitively pulls in — three
 * hops away, in a file whose author had no idea it was in the middleware bundle
 * — and every request through the gate pipeline breaks, at request time, on a
 * deployed environment.
 *
 * Measured when this landed: 23 files reachable from middleware.ts, importing
 * exactly three external packages (`@supabase/ssr`, `jose`, `next/server`), all
 * Edge-safe. Zero violations, so it ships blocking rather than baselined.
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
const SCRIPT = SRC.checkEdgeSafe;

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctl054-'));
});
afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

function graph(pairs, name) {
  const bySrc = new Map();
  for (const [s, d] of pairs) {
    if (!bySrc.has(s)) bySrc.set(s, []);
    bySrc.get(s).push({ resolved: d });
    if (!bySrc.has(d)) bySrc.set(d, []);
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

describe('CTL-054 — the checker itself', () => {
  test('its self-test passes and has not shrunk', () => {
    const { code, out } = run(['--self-test']);
    expect(`${code}: ${out.trim()}`).toContain('Self-test passed');
    expect(code).toBe(0);
    const n = Number(/Self-test passed \((\d+) cases\)/.exec(out)?.[1] ?? 0);
    expect(n).toBeGreaterThanOrEqual(15);
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

  test('the live middleware bundle is edge-safe', () => {
    const { code, out } = run([]);
    expect(`exit ${code}\n${out}`).toContain('Nothing in the edge bundle imports');
    expect(code).toBe(0);
  });
});

describe('CTL-054 — a scan that reached nothing must not read as clean', () => {
  test('a collapsed bundle fails CLOSED, not green', () => {
    // The failure this control is most likely to have. A traversal that
    // silently reaches nothing reports "0 banned imports" and a green tick,
    // indistinguishable from a genuinely clean bundle.
    const p = path.join(dir, 'thin.json');
    // The real entry point, via SRC — the assertion is ABOUT that path, so a
    // literal here would let a rename read as a pass. The two synthetic paths
    // below deliberately avoid the `src/` prefix so the shrink-only raw-literal
    // ratchet is not raised by files that will never exist.
    fs.writeFileSync(p, JSON.stringify({ modules: [{ source: SRC.middleware, dependencies: [] }] }));
    const { code, out } = run(['--graph', p]);
    expect(out).toMatch(/traversal failed/);
    expect(out).not.toMatch(/✓/);
    expect(code).toBe(2);
  });

  test('a renamed or missing entry point fails CLOSED', () => {
    // If middleware.ts moves, the honest answer is "I can no longer see the
    // edge bundle", not "the edge bundle is clean".
    const p = graph([['fixture-other.ts', 'fixture-x.ts']], 'noentry');
    const { code, out } = run(['--graph', p]);
    expect(out).toMatch(/none of the edge entry points/);
    expect(code).toBe(2);
  });
});

describe('CTL-054 — it scopes to the bundle, and to real imports', () => {
  test('a banned import OUTSIDE the bundle does not fire', () => {
    // A gate that fires on the whole repo would be wrong: `node:crypto` is
    // perfectly legal in Node-runtime code, and src/modules/age/didit.ts uses
    // it today. Scoping to the reachable set is the entire point.
    const { code, out } = run([]);
    expect(code).toBe(0);
    const usesNodeCrypto = execFileSync('git', ['grep', '-l', 'node:crypto', '--', 'src/'], {
      cwd: ROOT,
      encoding: 'utf-8',
    })
      .split('\n')
      .filter(Boolean);
    // Assert the precondition: if nothing outside the bundle used a banned
    // import, this test would prove nothing while staying green.
    expect(usesNodeCrypto.length).toBeGreaterThan(0);
    expect(out).toContain('0 banned import(s)');
  });

  test('a COMMENT naming a banned import does not fire (CTL-039)', () => {
    // The prose explaining a hazard must not be what trips the scan on it —
    // otherwise documenting the rule makes the file fail it, and this very
    // script's docstring names every banned specifier.
    const { code, out } = run(['--self-test']);
    expect(out).toContain('Self-test passed');
    expect(code).toBe(0);
    const src = fs.readFileSync(path.join(ROOT, SCRIPT), 'utf-8');
    expect(src).toMatch(/COMMENT_RE/);
  });

  test('@supabase/ssr is the SAFE one and must never be banned', () => {
    // The middleware uses it. Banning it would make the gate red on correct
    // code, which is how a gate gets deleted.
    const src = fs.readFileSync(path.join(ROOT, SCRIPT), 'utf-8');
    expect(src).toMatch(/"@supabase\/supabase-js":/);
    expect(src).not.toMatch(/"@supabase\/ssr":\s*"/);
  });
});

describe('CTL-054 — wired in, not merely written', () => {
  test('pr-checks runs the LIVE check, not only the self-test', () => {
    const wf = fs.readFileSync(path.join(ROOT, SRC.prChecks), 'utf-8');
    const live = wf
      .split('\n')
      .filter(
        (l) => l.includes(`python3 ${SCRIPT}`) && !l.includes('--self-test') && !/^\s*#/.test(l.trim()),
      );
    expect(`live invocations: ${live.length}`).toBe('live invocations: 1');
    expect(live[0]).not.toMatch(/--graph|--root/);
  });

  test('it is registered in the control registry', () => {
    const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'controls/registry.json'), 'utf-8'));
    const e = reg.controls.find((c) => c.id === 'CTL-054');
    expect(e).toBeDefined();
    expect(e.implementation).toBe(SCRIPT);
  });
});
