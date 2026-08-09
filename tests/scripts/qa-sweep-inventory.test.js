/**
 * KAN-467 Phase 1 — tests for qa-sweep/inventory.py.
 *
 * The inventory is the DENOMINATOR of every coverage number the sweep will
 * ever report, so the failure these tests exist to catch is under-reporting:
 * a surface that goes missing here does not appear as a gap, it disappears
 * entirely and the percentage goes UP. Several assertions below therefore
 * check that things are still COUNTED — low-confidence elements, admin pages,
 * denylisted actions — rather than that they are absent.
 *
 * Path literals are taken from the SRC manifest (tests/support/source-paths.ts)
 * or derived from the envelope at runtime, so this suite adds nothing to the
 * KAN-414 F4 raw-literal ratchet.
 *
 * Every test here was mutation-verified against the real subject.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SRC } = require('../support/source-paths.json');

const ROOT = path.resolve(__dirname, '../..');
const QA_DIR = path.join(ROOT, 'qa-sweep');
const INVENTORY = path.join(QA_DIR, 'inventory.py');
const CONFIG = path.join(QA_DIR, 'config.py');

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
 * Committed MINIMUM fixture count for `inventory.py --self-test`.
 *
 * `expect(stdout).toMatch(/self-test: \d+\/\d+ passed/)` moves its denominator
 * with its numerator, so it detects a fixture that FAILS and never one that is
 * DELETED. Measured 2026-08-04: cutting the inventory self-test from 41 checks
 * to 40 left this suite 19/19 green. May be RAISED; never lowered.
 */
const INVENTORY_SELF_TEST_FLOOR = 55;

/** Assert a `--self-test` passed everything AND ran at least `floor` fixtures. */
function assertSelfTestFloor(stdout, label, floor) {
  const m = new RegExp(`${label} self-test: (\\d+)/(\\d+) passed`).exec(stdout);
  expect(`${label} self-test line present`).toBe(m ? `${label} self-test line present` : 'MISSING');
  const [, passed, total] = m.map(Number);
  expect(`${label}:${passed}/${total}`).toBe(`${label}:${total}/${total}`);
  expect(total).toBeGreaterThanOrEqual(floor);
  return total;
}

/**
 * Blank out whole-line comments, preserving byte offsets so the scan below
 * cannot be satisfied by a commented-out declaration. CTL-039: this repo has
 * already shipped a source scan that a COMMENT satisfied.
 */
function maskCommentLines(src) {
  return src
    .split('\n')
    .map((line) => (/^\s*(\/\/|\*|\/\*)/.test(line) ? ' '.repeat(line.length) : line))
    .join('\n');
}

/**
 * INDEPENDENT FILESYSTEM ORACLE for the actions dimension.
 *
 * The routes dimension has had one since day one (walk the tree, count
 * page.tsx, compare). Actions had only a one-directional check — "every
 * inventoried action really exists in the file it names" — which validates what
 * the subject FOUND and by construction can never detect what it MISSED. It
 * duly reported green while ten real server actions were absent from the
 * denominator, because under-reporting is invisible from that direction: a
 * surface that goes missing does not appear as a gap, it disappears, and every
 * percentage computed from the denominator goes UP.
 *
 * So this derives the set from source, by three deliberately different regexes
 * rather than the subject's backwards-walking parser:
 *   1. a module whose FIRST code line is `'use server'` -> its exported functions
 *   2. any function whose body opens with its own `'use server'`
 *   3. any `=> { 'use server'` arrow — the anonymous inline form actions, which
 *      have no name in source and are inventoried as `inlineAction<N>`
 */
function discoverActionsOnDisk(appDir) {
  const found = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const rel = path.relative(ROOT, full).split(path.sep).join('/');
      const src = maskCommentLines(fs.readFileSync(full, 'utf-8'));
      const firstCodeLine = src.split('\n').map((l) => l.trim()).filter(Boolean)[0] || '';
      if (/^['"]use server['"]/.test(firstCodeLine)) {
        // Deliberately a DIFFERENT strategy from the subject's regex: split on
        // `export ` and read the declared name off each fragment. If the oracle
        // shared the subject's pattern it would share its blind spots too, and
        // could never detect the class of miss it exists to catch.
        for (const frag of src.split(/^export\s+/m).slice(1)) {
          const fn = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(frag);
          const arrow = /^const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?\(/.exec(frag);
          const hit = fn || arrow;
          if (hit) found.push({ file: rel, name: hit[1], anonymous: false });
        }
      }
      for (const m of src.matchAll(
        /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)[^{]*\{\s*['"]use server['"]/g,
      )) {
        found.push({ file: rel, name: m[1], anonymous: false });
      }
      let n = 0;
      for (const m of src.matchAll(/=>\s*\{\s*['"]use server['"]/g)) {
        void m;
        n += 1;
        found.push({ file: rel, name: `inlineAction${n}`, anonymous: true });
      }
    }
  })(appDir);
  return found;
}

let INV = null;
let ENVELOPE = null;

beforeAll(() => {
  const out = path.join(os.tmpdir(), `qa-inventory-${process.pid}.json`);
  const r = run(INVENTORY, ['--out', out]);
  expect(r.exitCode).toBe(0);
  INV = JSON.parse(fs.readFileSync(out, 'utf-8'));
  fs.rmSync(out, { force: true });

  const c = run(CONFIG, ['--show']);
  expect(c.exitCode).toBe(0);
  ENVELOPE = JSON.parse(c.stdout);
}, 120000);

describe('qa-sweep/inventory.py — parsing', () => {
  test('self-test passes, and runs at least its committed floor of fixtures', () => {
    const r = run(INVENTORY, ['--self-test']);
    assertSelfTestFloor(r.stdout, 'inventory', INVENTORY_SELF_TEST_FLOOR);
    expect(r.stdout).not.toMatch(/FAIL/);
    expect(r.exitCode).toBe(0);
  });

  test('the auth model is derived from middleware, not hardcoded', () => {
    // Derived means a middleware change moves the inventory instead of
    // silently invalidating it.
    const mw = fs.readFileSync(path.join(ROOT, SRC.middleware), 'utf-8');
    expect(mw).toContain("pathname.startsWith('/admin')");
    expect(INV.auth_model.admin_prefixes).toContain('/admin');
    expect(INV.auth_model.authed_prefixes).toContain('/dashboard');
  });

  test('routes are classified by that derived auth model', () => {
    const pages = INV.routes.filter((r) => r.kind === 'page');
    for (const p of pages) {
      if (p.path.startsWith('/admin')) expect(p.auth).toBe('admin');
      else if (p.path.startsWith('/dashboard')) expect(p.auth).toBe('authed');
      else expect(p.auth).toBe('public');
    }
  });

  test('every page.tsx on disk is inventoried', () => {
    // Independent oracle: walk the tree here rather than trusting the subject's
    // own count. Under-reporting is the one failure that flatters the report.
    const appDir = path.join(ROOT, 'src', 'app');
    const found = [];
    (function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === 'page.tsx') found.push(full);
      }
    })(appDir);
    const pages = INV.routes.filter((r) => r.kind === 'page');
    expect(pages.length).toBe(found.length);
  });

  test('route groups are erased and dynamic segments preserved', () => {
    const paths = INV.routes.filter((r) => r.kind === 'page').map((r) => r.path);
    expect(paths).toContain('/login'); // from (auth)/login
    expect(paths).toContain('/terms'); // from (legal)/terms
    expect(paths.some((p) => p.includes('('))).toBe(false);
    expect(paths).toContain('/[slug]');
  });

  test('route handlers are inventoried separately from pages', () => {
    const handlers = INV.routes.filter((r) => r.kind === 'route-handler');
    expect(handlers.length).toBeGreaterThan(0);
    expect(handlers.every((h) => h.file.endsWith('route.ts'))).toBe(true);
  });

  test('server actions are only taken from modules carrying "use server"', () => {
    // One direction: everything inventoried is really there, in the shape the
    // row claims. (The other direction — everything really there is
    // inventoried — is the oracle two tests below, and it is the one that can
    // detect a MISS.)
    for (const a of INV.actions) {
      const src = fs.readFileSync(path.join(ROOT, a.file), 'utf-8');
      expect(/^\s*['"]use server['"]/m.test(src)).toBe(true);
      if (a.declaration === 'exported') {
        // Either declaration form is a real exported action. Pinning only the
        // `function` shape would make this assertion reject the very thing the
        // widened parser exists to catch.
        expect(
          new RegExp(`export\\s+(?:async\\s+)?function\\s+${a.name}\\b`).test(src) ||
            new RegExp(`export\\s+const\\s+${a.name}\\b\\s*(?::[^=]+)?=\\s*(?:async\\s*)?\\(`).test(src),
        ).toBe(true);
      } else if (a.declaration === 'file-local') {
        expect(
          new RegExp(
            `function\\s+${a.name}\\s*\\([^)]*\\)[^{]*\\{\\s*['"]use server['"]`,
          ).test(src),
        ).toBe(true);
      } else {
        // Anonymous inline closure: no name in source, so the check is that the
        // file really contains an Nth `=> { 'use server'` arrow.
        expect(a.declaration).toBe('inline');
        expect(a.anonymous).toBe(true);
        const n = Number(/^inlineAction(\d+)$/.exec(a.name)[1]);
        expect((src.match(/=>\s*\{\s*['"]use server['"]/g) || []).length).toBeGreaterThanOrEqual(n);
      }
    }
  });

  test('all three declaration shapes are represented — the scan is not .ts-only', () => {
    // Before 2026-08-04 the scan was gated on `fn.endswith(".ts")` and the name
    // regex required `export`, so BOTH non-exported shapes were unreachable.
    const shapes = new Set(INV.actions.map((a) => a.declaration));
    expect([...shapes].sort()).toEqual(['exported', 'file-local', 'inline']);
    expect(INV.actions.some((a) => a.file.endsWith('.tsx'))).toBe(true);
  });

  test('every server action on disk is inventoried — an oracle for the denominator', () => {
    // Independent oracle, mirroring the page.tsx one above. Under-reporting the
    // denominator flatters every coverage number downstream, which is the whole
    // thing this tool exists to avoid.
    const disk = discoverActionsOnDisk(path.join(ROOT, 'src', 'app'));
    expect(disk.length).toBeGreaterThan(0);

    const inventoried = new Set(INV.actions.map((a) => `${a.file}::${a.name}`));
    const onDisk = [...new Set(disk.map((d) => `${d.file}::${d.name}`))];
    const missing = onDisk.filter((k) => !inventoried.has(k));
    expect(missing).toEqual([]);

    // Both directions, so the inventory can neither miss nor invent.
    const extra = [...inventoried].filter((k) => !onDisk.includes(k));
    expect(extra).toEqual([]);
    expect(INV.actions.length).toBe(onDisk.length);

    // And the oracle genuinely reaches the shapes that were being missed, so
    // this cannot pass because the oracle found only the easy ones.
    expect(disk.some((d) => /page\.tsx$/.test(d.file) && !d.anonymous)).toBe(true);
    expect(disk.some((d) => d.anonymous)).toBe(true);
  });

  test('low-confidence elements are retained, not dropped', () => {
    // Dropping them would shrink the denominator and inflate coverage.
    const low = INV.elements.filter((e) => e.confidence === 'low-confidence');
    expect(low.length).toBeGreaterThan(0);
    const unidentified = INV.elements.filter((e) => e.identifier === null);
    expect(unidentified.length).toBeGreaterThan(0);
    for (const e of unidentified) {
      expect(e.confidence).toBe('low-confidence');
      expect(INV.counts.elements_total).toBeGreaterThan(0);
    }
    expect(INV.counts.elements_by_confidence['low-confidence']).toBe(low.length);
  });

  test('form field constraints are captured from source', () => {
    const withMax = INV.fields.filter((f) => f.constraints.maxLength !== undefined);
    expect(withMax.length).toBeGreaterThan(0);
    const required = INV.fields.filter((f) => f.constraints.required !== undefined);
    expect(required.length).toBeGreaterThan(0);
  });

  test('every *-fields.ts module contributes its declared constraints', () => {
    // The first version of the parser matched only *_MAX_LENGTH / `as const`
    // and silently dropped four real constraint sets. Independent oracle: find
    // the files, then require each to be represented.
    const found = [];
    (function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('-fields.ts')) {
          found.push(path.relative(ROOT, full).split(path.sep).join('/'));
        }
      }
    })(path.join(ROOT, 'src'));
    expect(found.length).toBeGreaterThan(0);
    for (const rel of found) {
      expect(Object.keys(INV.constraint_modules)).toContain(rel);
      const mod = INV.constraint_modules[rel];
      const declared =
        Object.keys(mod.allowlists).length +
        Object.keys(mod.max_lengths).length +
        Object.keys(mod.label_tables).length;
      expect(declared).toBeGreaterThan(0);
    }
  });
});

describe('qa-sweep/inventory.py — scope flags', () => {
  test('a denylisted action is never marked exercisable', () => {
    const denylist = new Set(Object.keys(ENVELOPE.destructive_denylist));
    let seen = 0;
    for (const a of INV.actions) {
      const key = `${a.file}::${a.name}`;
      if (denylist.has(key)) {
        seen += 1;
        expect(a.scope).toBe('denylisted');
        expect(a.scope).not.toBe('exercisable');
        expect(String(a.scope_reason || '').length).toBeGreaterThan(0);
      }
    }
    // The denylist must actually have matched something — a rule that never
    // fires passes this test by vacuous truth.
    expect(seen).toBe(denylist.size);
  });

  test('deleteAccount specifically is denylisted', () => {
    // The worst case in the estate: its "type DELETE" confirmation is
    // client-side only, so clicking the button IS the deletion.
    const row = INV.actions.find(
      (a) => a.name === 'deleteAccount' && a.file === SRC.settingsActions,
    );
    expect(row).toBeDefined();
    expect(row.scope).toBe('denylisted');
  });

  test('every /admin route is inventory-only, and none is exercisable', () => {
    const adminRoutes = INV.routes.filter((r) => r.path.startsWith('/admin'));
    expect(adminRoutes.length).toBeGreaterThan(0);
    for (const r of adminRoutes) {
      expect(r.scope).toBe('inventory-only');
      expect(r.scope).not.toBe('exercisable');
    }
  });

  test('admin routes are still COUNTED — excluded from exercising, not omitted', () => {
    // Founder decision 2026-08-04: inventoried and coverage-diffed, never
    // clicked. Modelled as a flag so "we chose not to" cannot be confused with
    // "we forgot this exists".
    const adminPages = INV.routes.filter(
      (r) => r.kind === 'page' && r.path.startsWith('/admin'),
    );
    expect(adminPages.length).toBe(11); // verified independently: find src/app/admin -name page.tsx
    expect(INV.counts.pages_by_surface.admin).toBe(adminPages.length);
    expect(INV.counts.pages).toBeGreaterThanOrEqual(adminPages.length);
  });

  test('non-admin routes are not swept into inventory-only', () => {
    // The positive control: if everything were inventory-only, the test above
    // would still pass.
    const dash = INV.routes.filter((r) => r.path.startsWith('/dashboard'));
    expect(dash.length).toBeGreaterThan(0);
    for (const r of dash) expect(r.scope).toBe('exercisable');
  });

  test('elements on admin pages inherit inventory-only', () => {
    const adminEls = INV.elements.filter((e) => (e.route || '').startsWith('/admin'));
    expect(adminEls.length).toBeGreaterThan(0);
    for (const e of adminEls) expect(e.scope).toBe('inventory-only');
  });

  test('a prefix lookalike route is classified public, not admin', () => {
    // This test used to be a single `expect(selfTestExitCode).toBe(0)` with a
    // trailing comment claiming it covered `auth_model_for('/administrator')`.
    // It did not: deleting the /administrator fixture from the self-test left
    // it green, because the body asserted nothing about the behaviour the
    // comment named. That is CTL-039's exact shape — the prose documenting a
    // check is what conceals its removal.
    //
    // So this now BUILDS a tree containing the lookalike and reads the verdict
    // out of the inventory, with /admin and /dashboard beside it as paired
    // positive controls: if everything came back 'public' this would fail too.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-inv-lookalike-'));
    try {
      const qa = path.join(dir, 'qa-sweep');
      fs.mkdirSync(qa);
      fs.copyFileSync(INVENTORY, path.join(qa, 'inventory.py'));
      fs.copyFileSync(CONFIG, path.join(qa, 'config.py'));

      const page = 'export default function P() { return <div />; }\n';
      for (const seg of ['administrator', 'admin', 'dashboard']) {
        fs.mkdirSync(path.join(dir, 'src', 'app', seg), { recursive: true });
        fs.writeFileSync(path.join(dir, 'src', 'app', seg, 'page.tsx'), page);
      }
      fs.writeFileSync(
        path.join(dir, 'src', 'middleware.ts'),
        [
          'export function middleware(request) {',
          "  if (pathname.startsWith('/admin')) { return redirect(); }",
          "  if (!user && request.nextUrl.pathname.startsWith('/dashboard')) {",
          '    return redirect();',
          '  }',
          '}',
          '',
        ].join('\n'),
      );

      const out = path.join(dir, 'inv.json');
      const r = run(path.join(qa, 'inventory.py'), ['--out', out]);
      expect(r.exitCode).toBe(0);
      const inv = JSON.parse(fs.readFileSync(out, 'utf-8'));
      const pages = Object.fromEntries(
        inv.routes.filter((x) => x.kind === 'page').map((x) => [x.path, x]),
      );
      expect(Object.keys(pages).sort()).toEqual(['/admin', '/administrator', '/dashboard']);

      // The lookalike: NOT gated, NOT scoped out of the sweep.
      expect(pages['/administrator'].auth).toBe('public');
      expect(pages['/administrator'].scope).toBe('exercisable');

      // The controls: the real prefix IS gated and IS inventory-only.
      expect(pages['/admin'].auth).toBe('admin');
      expect(pages['/admin'].scope).toBe('inventory-only');
      expect(pages['/dashboard'].auth).toBe('authed');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('qa-sweep/inventory.py — fails closed', () => {
  test('exits 2 when src/app is absent', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-inv-'));
    try {
      const qa = path.join(dir, 'qa-sweep');
      fs.mkdirSync(qa);
      fs.copyFileSync(INVENTORY, path.join(qa, 'inventory.py'));
      fs.copyFileSync(CONFIG, path.join(qa, 'config.py'));
      const r = run(path.join(qa, 'inventory.py'), []);
      expect(r.exitCode).toBe(2);
      expect(r.stdout).toMatch(/FAILED CLOSED/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('exits 2 when the auth model derives to nothing', () => {
    // An empty authed-prefix list would reclassify every /dashboard page as
    // public — flattering exactly the numbers this tool exists to keep honest.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-inv-mw-'));
    try {
      const qa = path.join(dir, 'qa-sweep');
      fs.mkdirSync(qa);
      fs.copyFileSync(INVENTORY, path.join(qa, 'inventory.py'));
      fs.copyFileSync(CONFIG, path.join(qa, 'config.py'));
      fs.mkdirSync(path.join(dir, 'src', 'app'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'src', 'middleware.ts'),
        'export function middleware() { return null; }\n',
      );
      const r = run(path.join(qa, 'inventory.py'), []);
      expect(r.exitCode).toBe(2);
      expect(r.stdout).toMatch(/auth model derived to nothing/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
