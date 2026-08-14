/**
 * CTL-055 / KAN-415 §4.3 — a module may only touch tables it owns.
 *
 * WHY THIS EXISTS
 * ---------------
 * `modules.json` has carried `owns.tables` / `owns.rpcs` for every module since
 * the manifest was written, and until this control landed **nothing read them**.
 * An ownership map no code consults is documentation, and documentation
 * describing an enforced boundary is indistinguishable from an enforced
 * boundary right up until someone crosses it.
 *
 * The motivating case is Convene, which is the counter-example to a comfortable
 * assumption. It is the best-contained module in the estate — 2 declared entry
 * points, every outward import edge legal and downward, both facts enforced
 * two-way by CTL-051 and CTL-053 — and it still reaches 3 tables belonging to
 * other modules. **Enforcement on the IMPORT graph says nothing about the DATA
 * graph**, and the data graph is where a dark, un-soaked feature can quietly
 * mutate another module's state.
 *
 * WHY THESE TESTS DRIVE FIXTURES, NOT THIS REPO
 * ---------------------------------------------
 * CTL-053's first draft asserted against the real `modules.json`, so it tested
 * the DATA and not the CODE: every assertion would have survived the checker
 * being replaced with `exit 0`. These use the `--root` / `--manifest` /
 * `--baseline` seams to build small git repos with a known answer, so a fixture
 * failing means the checker is wrong rather than the estate having changed.
 *
 * Every case reaches the REAL script by subprocess (CTL-038) — no logic is
 * reimplemented here.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { SRC } = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../support/source-paths.json'), 'utf-8'),
);
const SCRIPT = SRC.checkModuleTableOwnership;
const BASELINE = SRC.tableOwnershipBaseline;

// gotcha #31 — a lost manifest key is `undefined`, and `undefined` makes
// `resolve(root, undefined)` throw something that reads like a broken harness.
// Assert the keys resolved before any test depends on them.
expect(typeof SCRIPT).toBe('string');
expect(typeof BASELINE).toBe('string');

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
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctl055-'));
});
afterAll(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

let fixtureSeq = 0;

/**
 * Fixture paths are SYNTHETIC — `<scan>/orders/a.ts` exists only inside a
 * throwaway git repo, never in this tree.
 *
 * They have to sit under a directory literally named `src`, because the checker
 * scans `git ls-files src`. But they must NOT be counted by the KAN-414 F4
 * shrink-only raw-literal ratchet, and that is not an evasion: the ratchet
 * exists to push REAL repo paths through `SRC` so that a file move updates one
 * manifest entry instead of N assertions. A fixture name that no file move can
 * ever invalidate is not the thing it is measuring.
 *
 * Routing them through `SRC` would be actively wrong. The generator keeps only
 * literals that RESOLVE ON DISK, so a synthetic path would be discarded on the
 * next regeneration and `SRC.x` would silently become `undefined` — gotcha #31,
 * which turns a negative assertion into one that passes forever.
 */
const SCAN_DIR = 'src'; // matches tracked_sources(): `git ls-files src`
const fx = (rel) => `${SCAN_DIR}/${rel}`;

/**
 * A real git repo, because the checker reads TRACKED state via `git ls-files`
 * and not the disk. `git mv` leaves the source directory behind empty, so a
 * disk walk answers a subtly different question — the failure mode that made a
 * KAN-414 ratchet pass locally on the exact defect it guarded.
 */
function fixture({ files, modules, baseline }) {
  const dir = path.join(tmp, `fx${fixtureSeq++}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  fs.writeFileSync(path.join(dir, 'modules.json'), JSON.stringify({ modules }, null, 2));
  if (baseline !== undefined) {
    fs.mkdirSync(path.join(dir, 'supabase'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'supabase', 'table-ownership-baseline.json'),
      JSON.stringify(baseline, null, 2),
    );
  }
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 'ctl055@test');
  git('config', 'user.name', 'ctl055');
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  return dir;
}

const check = (dir, extra = []) =>
  run(['--root', dir, '--min-call-sites', '1', ...extra], { cwd: dir });

const MODS = {
  orders: { paths: [fx('orders/')], owns: { tables: ['order'], rpcs: ['place_order'] } },
  users: { paths: [fx('users/')], owns: { tables: ['account'] } },
};

describe('CTL-055 — the checker itself, driven by fixtures', () => {
  test('a module touching only its own table passes', () => {
    const dir = fixture({
      files: { [fx('orders/a.ts')]: "db.from('order').select()\n" },
      modules: MODS,
      baseline: { violations: {} },
    });
    const r = check(dir);
    expect(`code=${r.code} :: ${r.out.trim().split('\n').pop()}`).toBe(
      'code=0 :: Every database call is on a table its module owns, or is baselined. ✓',
    );
  });

  test('a module touching ANOTHER module\'s table fails, and names the real owner', () => {
    const dir = fixture({
      files: { [fx('orders/a.ts')]: "db.from('account').select()\n" },
      modules: MODS,
      baseline: { violations: {} },
    });
    const r = check(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain('NEW    orders -> account');
    // Naming the owner is the load-bearing half of the message: without it the
    // reader knows a boundary broke but not which one to talk to.
    expect(r.out).toContain('owned by users');
  });

  test('an `owns.rpcs` entry counts as ownership, not just `owns.tables`', () => {
    const dir = fixture({
      files: { [fx('orders/a.ts')]: "db.rpc('place_order', {})\n" },
      modules: MODS,
      baseline: { violations: {} },
    });
    expect(check(dir).code).toBe(0);
  });

  test('a table NO module owns is still a violation — an orphan is not a licence', () => {
    const dir = fixture({
      files: { [fx('orders/a.ts')]: "db.from('nobody_owns_this').select()\n" },
      modules: MODS,
      baseline: { violations: {} },
    });
    const r = check(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain('owned by NO module');
  });

  test('a COMMENTED-OUT call is documentation, not an access (CTL-039)', () => {
    // The failure mode this guards is the inverse of the usual one: the prose
    // explaining why a call was removed would otherwise re-create the finding,
    // and a gate that punishes writing the explanation down teaches people to
    // stop writing it.
    const dir = fixture({
      files: {
        // A real call alongside it, so the corpus is non-empty. Without one the
        // floor fires first and the run exits 2 — a pass for a reason that has
        // nothing to do with comment handling.
        [fx('orders/a.ts')]: "// db.from('account').select()\ndb.from('order').select()\n",
      },
      modules: MODS,
      baseline: { violations: {} },
    });
    const r = check(dir);
    expect(r.code).toBe(0);
    // Exactly one counted call proves the commented one was SKIPPED, not merely
    // unflagged. Asserting only `code === 0` would also pass if comments were
    // counted but happened to be owned.
    expect(r.out).toContain('1 database call site(s) outside `profiles`');
  });
});

describe('CTL-055 — the ratchet turns both ways', () => {
  const files = { [fx('orders/a.ts')]: "db.from('account').select()\n" };

  test('a baselined violation passes — it ships green, so it does not get switched off', () => {
    const dir = fixture({
      files,
      modules: MODS,
      baseline: { violations: { 'orders -> account': '1 site(s)' } },
    });
    expect(check(dir).code).toBe(0);
  });

  test('a FIXED violation still in the baseline fails as STALE', () => {
    // Without this half the file could only grow, which makes it a suppression
    // list rather than a ratchet.
    const dir = fixture({
      files: { [fx('orders/a.ts')]: "db.from('order').select()\n" },
      modules: MODS,
      baseline: { violations: { 'orders -> account': '1 site(s)' } },
    });
    const r = check(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain('STALE  orders -> account');
  });

  test('a baseline entry for a pair that never existed also fails as STALE', () => {
    const dir = fixture({
      files,
      modules: MODS,
      baseline: { violations: { 'orders -> account': 'real', 'users -> order': 'invented' } },
    });
    const r = check(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain('STALE  users -> order');
    expect(r.out).not.toContain('STALE  orders -> account');
  });
});

describe('CTL-055 — it fails closed rather than reporting a clean estate', () => {
  test('a missing baseline is exit 2, not a pass', () => {
    const dir = fixture({ files: { [fx('orders/a.ts')]: "db.from('order').select()\n" }, modules: MODS });
    const r = check(dir);
    expect(`code=${r.code}`).toBe('code=2');
    expect(r.out).toContain('refusing to');
  });

  test('a corrupt baseline is exit 2, not a pass', () => {
    const dir = fixture({
      files: { [fx('orders/a.ts')]: "db.from('order').select()\n" },
      modules: MODS,
      baseline: { violations: {} },
    });
    fs.writeFileSync(path.join(dir, 'supabase', 'table-ownership-baseline.json'), '{ not json');
    const r = check(dir);
    expect(r.code).toBe(2);
    expect(r.out).toContain('not valid JSON');
  });

  test('a manifest declaring no modules is exit 2, not a vacuous pass', () => {
    // Zero modules means zero owners means zero pairs means zero violations.
    // That is the shape of catalogue failure mode 4 — a clean result computed
    // over an empty corpus — and it must not read as success.
    const dir = fixture({
      files: { [fx('orders/a.ts')]: "db.from('order').select()\n" },
      modules: {},
      baseline: { violations: {} },
    });
    const r = check(dir);
    expect(r.code).toBe(2);
    expect(r.out).toContain('declares no modules');
  });

  test('a scan finding fewer call sites than the floor is exit 2', () => {
    // The real regression this models: the detector stops matching (a Supabase
    // client API change, a regex edit) and the estate reads as spotless.
    const dir = fixture({
      files: { [fx('orders/a.ts')]: "db.from('order').select()\n" },
      modules: MODS,
      baseline: { violations: {} },
    });
    const r = run(['--root', dir, '--min-call-sites', '999'], { cwd: dir });
    expect(r.code).toBe(2);
    expect(r.out).toContain('zero findings over zero input is not a pass');
  });

  test('an UNTRACKED file is invisible — tracked state, not disk state', () => {
    // `git mv` leaves the source directory behind empty, so a disk walk and
    // `git ls-files` answer different questions. A KAN-414 ratchet used
    // `fs.existsSync` and stayed green on the exact defect it guarded.
    const dir = fixture({
      files: { [fx('orders/a.ts')]: "db.from('order').select()\n" },
      modules: MODS,
      baseline: { violations: {} },
    });
    fs.writeFileSync(path.join(dir, 'src', 'orders', 'untracked.ts'), "db.from('account').select()\n");
    expect(check(dir).code).toBe(0);
    execFileSync('git', ['add', fx('orders/untracked.ts')], { cwd: dir, stdio: 'pipe' });
    expect(check(dir).code).toBe(1);
  });
});

describe('CTL-055 — read vs write, and the direction the classifier fails', () => {
  // `owns` means "may WRITE". So a cross-module read is legitimate and a
  // cross-module write is a boundary break, and getting the classification
  // right is what keeps the baseline a short list of real work instead of a
  // renewal ritual over 56 mostly-fine entries.
  const cases = [
    ['a plain select is a read', "db.from('account').select('*').eq('id', x);\n", 'read'],
    ['an update is a write', "db.from('account').update({ a: 1 }).eq('id', x);\n", 'write'],
    ['an insert is a write', "db.from('account').insert({ a: 1 });\n", 'write'],
    ['a delete is a write', "db.from('account').delete().eq('id', x);\n", 'write'],
    [
      'a write chained across lines is still a write',
      "await db\n  .from('account')\n  .upsert({ a: 1 })\n  .select();\n",
      'write',
    ],
    [
      'one write among many reads makes the PAIR a write',
      "db.from('account').select('*');\ndb.from('account').select('id');\ndb.from('account').delete();\n",
      'write',
    ],
  ];

  test.each(cases)('%s', (_label, body, expected) => {
    const dir = fixture({
      files: { [fx('orders/a.ts')]: body },
      modules: MODS,
      baseline: { violations: { 'orders -> account': { mode: expected } } },
    });
    // Baselined with the EXPECTED mode: a mismatch surfaces as ESCALATED or
    // STALE, so exit 0 is a positive assertion about the classification rather
    // than merely "nothing blew up".
    const r = check(dir);
    expect(`${_label}: code=${r.code}\n${r.out}`).toContain(`${_label}: code=0`);
  });

  test('an UNDECIDABLE statement is a write, never a silent read', () => {
    // `const q = db.from('x');` terminates without doing anything — the write
    // happens later through the variable, which static analysis cannot follow.
    // Classifying it `read` would park a real write in the accepted bucket,
    // where it could never be caught escalating because it was already a write.
    const dir = fixture({
      files: { [fx('orders/a.ts')]: "const q = db.from('account');\nawait q.update({ a: 1 });\n" },
      modules: MODS,
      baseline: { violations: { 'orders -> account': { mode: 'read' } } },
    });
    const r = check(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain('ESCALATED');
  });

  test('an `.rpc()` is undecidable and labelled as such, not guessed at', () => {
    // The function body is SQL and not in this import tree. It is flagged
    // conservatively AND marked `rpc-undecidable`, so a reader knows to verify
    // it against supabase/migrations/ rather than treat it as a finding.
    const dir = fixture({
      files: { [fx('orders/a.ts')]: "await db.rpc('some_account_fn');\n" },
      modules: MODS,
      baseline: { violations: {} },
    });
    const r = check(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain('[WRITE]');
    const written = fixture({
      files: { [fx('orders/a.ts')]: "await db.rpc('some_account_fn');\n" },
      modules: MODS,
      baseline: { violations: {} },
    });
    expect(run(['--root', written, '--min-call-sites', '1', '--write-baseline'], { cwd: written }).code).toBe(0);
    const b = JSON.parse(
      fs.readFileSync(path.join(written, 'supabase', 'table-ownership-baseline.json'), 'utf-8'),
    );
    expect(b.violations['orders -> some_account_fn'].basis).toBe('rpc-undecidable');
  });
});

describe('CTL-055 — ESCALATION: the hole the first cut could not see', () => {
  // A pair is keyed `module -> table`. A baselined READ that quietly becomes a
  // WRITE keeps the same key, so the pair count does not move and the old
  // control stayed green — a module beginning to mutate state it does not own,
  // with nothing going red. That is the BUGS-74 shape.
  const readBody = "db.from('account').select('*');\n";
  const writeBody = "db.from('account').select('*');\ndb.from('account').update({ a: 1 });\n";

  test('read -> write fails as ESCALATED, and says why it matters', () => {
    const dir = fixture({
      files: { [fx('orders/a.ts')]: writeBody },
      modules: MODS,
      baseline: { violations: { 'orders -> account': { mode: 'read' } } },
    });
    const r = check(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain('ESCALATED  orders -> account');
    expect(r.out).toContain("owns` = 'may write'");
  });

  test('the pair count is UNCHANGED across the escalation — which is the whole point', () => {
    // If the count moved, the plain NEW/STALE ratchet would already have caught
    // it and this mechanism would be redundant. Pin that it does not.
    const mk = (body) =>
      fixture({
        files: { [fx('orders/a.ts')]: body },
        modules: MODS,
        baseline: { violations: { 'orders -> account': { mode: 'read' } } },
      });
    const asRead = check(mk(readBody));
    const asWrite = check(mk(writeBody));
    const pairs = (out) => /(\d+) \(module -> table\) pair\(s\) unowned/.exec(out)?.[1];
    expect(pairs(asRead.out)).toBe('1');
    expect(`escalated pair count: ${pairs(asWrite.out)}`).toBe('escalated pair count: 1');
    expect(asRead.code).toBe(0);
    expect(asWrite.code).toBe(1);
  });

  test('write -> read fails as STALE — the record must follow the code both ways', () => {
    const dir = fixture({
      files: { [fx('orders/a.ts')]: readBody },
      modules: MODS,
      baseline: { violations: { 'orders -> account': { mode: 'write' } } },
    });
    const r = check(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain('STALE');
  });

  test('a legacy string baseline entry is read as a READ, not crashed on', () => {
    // The first baseline format stored a prose string per pair. Tolerating it
    // matters because the alternative — a TypeError — would fail closed in a
    // way that looks like a broken harness rather than a format change.
    const dir = fixture({
      files: { [fx('orders/a.ts')]: readBody },
      modules: MODS,
      baseline: { violations: { 'orders -> account': '1 site(s); owned by users' } },
    });
    expect(check(dir).code).toBe(0);
  });
});

describe('CTL-055 — `profiles` is out of scope BY POLICY, and the policy is stated', () => {
  test('a `profiles` access is neither counted nor flagged', () => {
    const dir = fixture({
      files: { [fx('orders/a.ts')]: "db.from('profiles').select()\ndb.from('order').select()\n" },
      modules: MODS,
      baseline: { violations: {} },
    });
    const r = check(dir);
    expect(r.code).toBe(0);
    // Not merely unflagged — not counted, so it cannot inflate the floor and
    // disguise a detector that has stopped seeing everything else.
    expect(r.out).toContain('1 database call site(s) outside `profiles`');
  });

  test('the exclusion is documented with its alternative instrument, not just asserted', () => {
    // A carve-out with no stated reason is how a gap becomes permanent. The
    // docstring must name WHY (column co-ownership; 6 of 18 writes pass a
    // variable so static column analysis would be dishonest) and WHAT covers it
    // instead. If someone deletes that reasoning, this goes red.
    const src = fs.readFileSync(path.join(ROOT, SCRIPT), 'utf-8');
    expect(src).toContain('COLUMN granularity');
    // A plain literal, deliberately: `tests/` is outside the prefixes the SRC
    // generator harvests, so this cannot trip the raw-literal ratchet — and an
    // `|| fallback` here would silently weaken the assertion to a substring
    // match if the key ever vanished (gotcha #31).
    expect(src).toContain('tests/unit/partial-write-safety.test.ts');
  });
});

describe('CTL-055 — this repo, as it actually stands', () => {
  test('the real estate is green', () => {
    const r = run([]);
    expect(`code=${r.code} :: ${r.out.trim().split('\n').pop()}`).toBe(
      'code=0 :: Every database call is on a table its module owns, or is baselined. ✓',
    );
  });

  test('the self-test passes and covers a non-trivial number of cases', () => {
    const r = run(['--self-test']);
    expect(r.code).toBe(0);
    const n = Number(/Self-test passed \((\d+) cases\)/.exec(r.out)?.[1]);
    expect(n).toBeGreaterThanOrEqual(13);
  });

  test('every baselined pair carries a mode and a basis', () => {
    // Without these the file is a flat list of 56 "boundary breaks", 44 of
    // which are legitimate reads. The fields are what make it a short list of
    // real work rather than a renewal ritual.
    const b = JSON.parse(fs.readFileSync(path.join(ROOT, BASELINE), 'utf-8'));
    const entries = Object.entries(b.violations);
    expect(entries.length).toBeGreaterThan(20);
    const bad = entries.filter(
      ([, v]) => !['read', 'write'].includes(v.mode) || typeof v.basis !== 'string',
    );
    expect(`entries missing mode/basis: ${JSON.stringify(bad.map(([k]) => k))}`).toBe(
      'entries missing mode/basis: []',
    );
    // Both modes must actually occur, or the classification is doing nothing.
    const modes = new Set(entries.map(([, v]) => v.mode));
    expect([...modes].sort()).toEqual(['read', 'write']);
  });

  test('a conservative write is labelled, so an over-flag is not read as a finding', () => {
    // `account -> search_by_contact_hash` is provably `return query select` in
    // supabase/migrations/, and is flagged write on purpose because an RPC body
    // is not in the import tree. If nothing distinguished it from hard evidence,
    // the write list would contain an unexplained false positive — and a list
    // with one of those is a list people stop trusting.
    const b = JSON.parse(fs.readFileSync(path.join(ROOT, BASELINE), 'utf-8'));
    const writes = Object.entries(b.violations).filter(([, v]) => v.mode === 'write');
    expect(writes.length).toBeGreaterThan(0);
    const bases = new Set(writes.map(([, v]) => v.basis));
    // Hard evidence must exist, or `mutation-call` detection has broken.
    expect(bases.has('mutation-call')).toBe(true);
    expect(b._concentration.writes).toBe(writes.length);
  });

  test('the baseline records the concentration, so 56 pairs are not read as 56 tangles', () => {
    const b = JSON.parse(fs.readFileSync(path.join(ROOT, BASELINE), 'utf-8'));
    const pairs = Object.keys(b.violations);
    expect(pairs.length).toBeGreaterThan(20);
    expect(b._concentration.pairs).toBe(pairs.length);
    const top = Object.values(b._concentration.topFiles);
    expect(top.length).toBeGreaterThan(0);
    // The point of the field: one file carries a large share of the pairs
    // because erasure touches every table by definition. If that ever stops
    // being true the number moves and the note stops being needed — either way
    // the file is measured rather than remembered.
    expect(Math.max(...top)).toBeGreaterThan(1);
  });

  test('every baselined pair names a module that still exists', () => {
    // A pair naming a deleted module can never go STALE by being fixed, so it
    // would sit in the baseline forever, unfalsifiable.
    const b = JSON.parse(fs.readFileSync(path.join(ROOT, BASELINE), 'utf-8'));
    const known = new Set(
      Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'modules.json'), 'utf-8')).modules),
    );
    const orphans = Object.keys(b.violations).filter((k) => !known.has(k.split(' -> ')[0]));
    expect(`baselined pairs naming an unknown module: ${JSON.stringify(orphans)}`).toBe(
      'baselined pairs naming an unknown module: []',
    );
  });

  test('Convene — the case that motivated this — is actually caught', () => {
    // The concrete claim in the docstring, pinned. Convene passes CTL-051 and
    // CTL-053 cleanly and still reaches tables it does not own; if that ever
    // stops being true these entries go STALE and the checker says so.
    const b = JSON.parse(fs.readFileSync(path.join(ROOT, BASELINE), 'utf-8'));
    const convene = Object.keys(b.violations).filter((k) => k.startsWith('convene -> '));
    expect(convene.length).toBeGreaterThan(0);
  });
});
