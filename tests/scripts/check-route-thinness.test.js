/**
 * CTL-056 / KAN-415 criterion 2 — `app-routes-are-thin`, as a ratchet.
 *
 * WHY THIS CONTROL EXISTS AT ALL
 * ------------------------------
 * Criterion 2 names nine dependency rules. Eight are enforced. This was the
 * ninth, and it was never built — not because it was hard, but because "thin"
 * was never given a meaning anyone could check. An unmeasurable criterion is
 * indistinguishable from an unmet one, and it had sat that way for the whole
 * programme.
 *
 * WHY A RATCHET AND NOT "ZERO"
 * ----------------------------
 * "A route makes no direct database call" is the right end state and the wrong
 * gate: 48 of 99 route files make 217 such calls today. Shipping that as a hard
 * rule is a 48-file relocation programme — exactly the work criterion 3
 * concluded was unnecessary once CTL-055 could assert table ownership without
 * moving files — and a gate that reddens 48 files on day one is a gate someone
 * turns off. This estate has six documented instances of that ending badly.
 *
 * These tests drive FIXTURES through the real script (CTL-038), not the repo,
 * so a failure here means the checker is wrong rather than the estate changed.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { SRC } = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../support/source-paths.json'), 'utf-8'),
);
const SCRIPT = SRC.checkRouteThinness;
const BASELINE = SRC.routeThinnessBaseline;

// gotcha #31 — a lost manifest key is `undefined`, and `resolve(root, undefined)`
// throws something that reads like a broken harness rather than a lost key.
expect(typeof SCRIPT).toBe('string');
expect(typeof BASELINE).toBe('string');
expect(typeof SRC.app).toBe('string');

function run(args, opts = {}) {
  try {
    return {
      code: 0,
      out: execFileSync('python3', [path.join(ROOT, SCRIPT), ...args], {
        cwd: opts.cwd || ROOT,
        encoding: 'utf-8',
      }),
    };
  } catch (err) {
    return { code: err.status, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

let tmp;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctl056-'));
});
afterAll(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

let seq = 0;

/**
 * A real git repo — the checker reads TRACKED state via `git ls-files`, not the
 * disk, because `git mv` leaves the source directory behind empty and a disk
 * walk therefore answers a subtly different question.
 */
function fixture({ files, baseline }) {
  const dir = path.join(tmp, `fx${seq++}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  if (baseline !== undefined) {
    fs.mkdirSync(path.join(dir, 'supabase'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'supabase', 'route-thinness-baseline.json'),
      JSON.stringify(baseline, null, 2),
    );
  }
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 'ctl056@test');
  git('config', 'user.name', 'ctl056');
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  return dir;
}

/**
 * Fixture paths are assembled, never written whole.
 *
 * The checker lists tracked files under the app directory, so fixtures must live under a
 * directory of that name — but several of the natural names (a real page path)
 * are REAL files in this repo, so writing them as literals would feed the
 * KAN-414 F4 raw-literal ratchet 22 new entries. That ratchet is shrink-only and
 * exists to push real repo paths through `SRC`; a synthetic fixture name is not
 * the thing it is measuring.
 *
 * Routing these through `SRC` would be actively wrong for the opposite reason:
 * the generator keeps only literals that RESOLVE, so a synthetic path would be
 * discarded on the next regeneration and `SRC.x` would silently become
 * `undefined` (gotcha #31).
 */
const APP = SRC.app;
const fx = (rel) => `${APP}/${rel}`;

const check = (dir, extra = []) => run(['--root', dir, '--min-routes', '1', ...extra], { cwd: dir });

describe('CTL-056 — the ratchet, driven by fixtures', () => {
  test('a route with no database call passes', () => {
    const dir = fixture({
      files: { [fx('page.tsx')]: 'export default function P() { return null; }\n' },
      baseline: { routes: {} },
    });
    const r = check(dir);
    expect(`${r.code} :: ${r.out.trim().split('\n').pop()}`).toBe(
      '0 :: No route gained a direct database call. ✓',
    );
  });

  test('a NEW route call site fails and says what to do about it', () => {
    const dir = fixture({
      files: { [fx('page.tsx')]: "const x = await db.from('t').select();\n" },
      baseline: { routes: {} },
    });
    const r = check(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`NEW    ${fx('page.tsx')}`);
    // A gate that says "no" without saying "instead" gets worked around.
    expect(r.out).toContain('Move the query into the owning module');
  });

  test('a baselined route at the same count passes — it ships green', () => {
    const dir = fixture({
      files: { [fx('page.tsx')]: "const x = await db.from('t').select();\n" },
      baseline: { routes: { [fx('page.tsx')]: 1 } },
    });
    expect(check(dir).code).toBe(0);
  });

  test('a baselined route that GROWS fails — the ratchet is one-way', () => {
    const dir = fixture({
      files: {
        [fx('page.tsx')]: "const x = await db.from('t').select();\nconst y = await db.from('u').select();\n",
      },
      baseline: { routes: { [fx('page.tsx')]: 1 } },
    });
    const r = check(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`WORSE  ${fx('page.tsx')} went from 1 to 2`);
  });

  test('a baselined route that SHRINKS fails as stale, so the file keeps describing reality', () => {
    const dir = fixture({
      files: { [fx('page.tsx')]: "const x = await db.from('t').select();\n" },
      baseline: { routes: { [fx('page.tsx')]: 5 } },
    });
    const r = check(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain('STALE');
  });

  test('one file improving does NOT mask another regressing', () => {
    // The reason this is keyed per file rather than on a total. Under an
    // aggregate these two changes net to zero and the run is green.
    const dir = fixture({
      files: {
        [fx('good/page.tsx')]: 'export default function P() { return null; }\n',
        [fx('bad/page.tsx')]: "const a = db.from('t').select();\nconst b = db.from('u').select();\n",
      },
      baseline: { routes: { [fx('good/page.tsx')]: 2, [fx('bad/page.tsx')]: 1 } },
    });
    const r = check(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`WORSE  ${fx('bad/page.tsx')}`);
    expect(r.out).toContain(`STALE  ${fx('good/page.tsx')}`);
  });
});

describe('CTL-056 — what counts, and the two traps', () => {
  test('Array.from and Buffer.from are not database calls', () => {
    // 8 such lines exist in the real route files. Borrowing a loose
    // `\\.(from|rpc)\\(` pattern would flag every one of them, and a gate with
    // known false positives is a gate people learn to wave through.
    const dir = fixture({
      files: {
        [fx('page.tsx')]:
          'const ids = Array.from(new Set(xs));\nconst s = Buffer.from(b64, "base64").toString();\n',
      },
      baseline: { routes: {} },
    });
    expect(check(dir).code).toBe(0);
  });

  test('a hyphenated storage bucket and a variable table name BOTH count', () => {
    // The opposite trap, and the one that undercounts silently. CTL-055
    // requires a quoted identifier because it needs the table NAME; reusing
    // that pattern here misses `supabase.storage.from('profile-files')` — 7
    // real call sites — and `.from(someVar)` entirely.
    const dir = fixture({
      files: {
        [fx('page.tsx')]:
          "await supabase.storage.from('profile-files').remove([p]);\nawait admin.storage.from(bucketVar).list(uid);\n",
      },
      baseline: { routes: {} },
    });
    const r = check(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain('makes 2 direct database call(s)');
  });

  test('a commented-out call is documentation, not an access (CTL-039)', () => {
    const dir = fixture({
      files: {
        [fx('page.tsx')]:
          "// const x = await db.from('t').select();  <- moved into the module\nexport default function P() { return null; }\n",
      },
      baseline: { routes: {} },
    });
    expect(check(dir).code).toBe(0);
  });

  test('a non-route file beside a route is out of scope', () => {
    // A helper module next to a page is ordinary code. Widening this to every
    // file under the app directory would make this a duplicate of CTL-055 with a
    // worse question.
    const dir = fixture({
      files: {
        [fx('page.tsx')]: 'export default function P() { return null; }\n',
        [fx('helper.ts')]: "export const load = () => db.from('t').select();\n",
      },
      baseline: { routes: {} },
    });
    expect(check(dir).code).toBe(0);
  });

  test('an API route IS a route', () => {
    const dir = fixture({
      files: { [fx('api/x/route.ts')]: "const x = await db.from('t').select();\n" },
      baseline: { routes: {} },
    });
    expect(check(dir).code).toBe(1);
  });
});

describe('CTL-056 — fails closed rather than reporting a clean scan', () => {
  test('a missing baseline is exit 2, not a pass', () => {
    const dir = fixture({
      files: { [fx('page.tsx')]: "const x = await db.from('t').select();\n" },
      baseline: undefined,
    });
    const r = check(dir);
    expect(r.code).toBe(2);
    expect(r.out).toContain('refusing to');
  });

  test('a corrupt baseline is exit 2, not a pass', () => {
    const dir = fixture({
      files: { [fx('page.tsx')]: 'export default function P() { return null; }\n' },
      baseline: { routes: {} },
    });
    fs.writeFileSync(path.join(dir, 'supabase', 'route-thinness-baseline.json'), '{ not json');
    expect(check(dir).code).toBe(2);
  });

  test('too few routes is exit 2 — a scan that stopped finding things has broken', () => {
    const dir = fixture({
      files: { [fx('page.tsx')]: 'export default function P() { return null; }\n' },
      baseline: { routes: {} },
    });
    // Default floor, not the relaxed --min-routes the other cases use.
    const r = run(['--root', dir], { cwd: dir });
    expect(r.code).toBe(2);
    expect(r.out).toContain('has broken, not been cleaned up');
  });

  test('its self-test passes and has not shrunk', () => {
    const { code, out } = run(['--self-test']);
    expect(code).toBe(0);
    const n = Number(/Self-test passed \((\d+) cases\)/.exec(out)?.[1] ?? 0);
    expect(n).toBeGreaterThanOrEqual(16);
  });
});

describe('CTL-056 — the committed baseline describes the real estate', () => {
  test('it is non-empty and records its own totals', () => {
    const b = JSON.parse(fs.readFileSync(path.join(ROOT, BASELINE), 'utf-8'));
    expect(Object.keys(b.routes).length).toBeGreaterThan(20);
    // Computed at --write-baseline, never typed, so it cannot go stale.
    expect(b._totals.filesWithCalls).toBe(Object.keys(b.routes).length);
    expect(b._totals.calls).toBe(Object.values(b.routes).reduce((a, n) => a + n, 0));
  });

  test('every baselined path is a tracked route file that still exists', () => {
    // A move would otherwise leave an entry pointing at nothing, and the STALE
    // arm would fire forever with no way to tell a fix from a rename.
    const b = JSON.parse(fs.readFileSync(path.join(ROOT, BASELINE), 'utf-8'));
    const tracked = new Set(
      execFileSync('git', ['ls-files', APP], { cwd: ROOT, encoding: 'utf-8' }).split('\n'),
    );
    const missing = Object.keys(b.routes).filter((p) => !tracked.has(p));
    expect(`baselined routes no longer tracked: ${JSON.stringify(missing)}`).toBe(
      'baselined routes no longer tracked: []',
    );
  });
});
