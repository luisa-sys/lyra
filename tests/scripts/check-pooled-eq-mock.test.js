/**
 * CTL-076 / KAN-459 §2 — a test-side Supabase mock records filters PER STATEMENT.
 *
 * WHY THIS CONTROL EXISTS
 * -----------------------
 * KAN-447/448 asserted the owner-scoping of an UPDATE through a mock that
 * pooled `.eq()` calls per TABLE. `updateSchoolAffiliation` reads the row before
 * it writes it, so the SELECT's own `.eq('id', …)` / `.eq('profile_id', …)`
 * landed in the same pool — and both filters could be deleted from the UPDATE
 * while all 27 tests stayed green. The realised impact of that class is editing
 * another member's row, or bulk-overwriting every row of your own.
 *
 * It is catalogue failure mode 2 turned inside out: there a COMMENT satisfies
 * the assertion, here an incidental ADJACENT STATEMENT does. Both fire
 * constantly and answer a different question from the one asked.
 *
 * These tests drive FIXTURES through the real script (CTL-038), never a
 * reimplementation of its logic, so a failure here means the checker is wrong
 * rather than that the estate changed.
 *
 * ⚠️ THE SANDBOX IS A REAL GIT REPO ON PURPOSE. The checker reads TRACKED state
 * via `git ls-files`, because `git mv` leaves the source directory behind empty
 * and a disk walk therefore answers a subtly different question (catalogue
 * failure mode 6). A fixture that is written but not `git add`ed is invisible to
 * the checker — which is the same trap that reddened CTL-035 twice.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { SRC } = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../support/source-paths.json'), 'utf-8'),
);
const SCRIPT = SRC.checkPooledEqMock;

// gotcha #31 — a lost manifest key is `undefined`, and `path.join(root, undefined)`
// throws something that reads like a broken harness rather than a lost key.
expect(typeof SCRIPT).toBe('string');
expect(typeof SRC.prChecks).toBe('string');

// Not routed through SRC: the generator harvests only src/supabase/scripts/
// public/design/.github literals, so no `tests/` path can ever hold a key. It is
// therefore also not counted by the F4 raw-literal ratchet.
const BASELINE_REL = 'tests/support/pooled-eq-mock-baseline.json';

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
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctl076-'));
});
afterAll(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

let seq = 0;

/**
 * A throwaway git repo holding `files`, all tracked, plus `baseline` if given.
 * `padding` synthesises enough inert mock files to clear the checker's corpus
 * floors — the floors exist so a glob that stops matching fails rather than
 * reporting clean, and a fixture repo has to satisfy them like anything else.
 */
function sandbox({ files, baseline, padding = 0 }) {
  const dir = path.join(tmp, `case-${seq++}`);
  fs.mkdirSync(path.join(dir, 'tests', 'unit'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tests', 'support'), { recursive: true });

  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  for (let i = 0; i < padding; i += 1) {
    fs.writeFileSync(
      path.join(dir, 'tests', 'unit', `pad-${i}.test.ts`),
      // Inert: an .eq() recorder that records nothing by table, so it counts
      // toward the "files with a recorder" floor without being a finding.
      'const o = { eq: (c: string, v: unknown) => { seen.push([c, v]); return o; } };\n',
    );
  }
  if (baseline !== undefined) {
    fs.writeFileSync(path.join(dir, BASELINE_REL), JSON.stringify(baseline, null, 2));
  }

  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  return dir;
}

/**
 * ⚠️ THE POOLED FIXTURES ARE ASSEMBLED, NOT WRITTEN OUT — and that is deliberate.
 *
 * This file is a tracked file under `tests/`, so the checker scans it like any
 * other. Written as literal text, its own fixtures make it a finding: the guard
 * fires on its own test corpus, which is the CTL-061 failure (a guard tripping
 * on its own registration prose). The fix is NOT to exclude this path — an
 * excluded file is a file the control has stopped covering. It is to build the
 * violating subscript at runtime, exactly as CTL-064's suite assembles its
 * `git push` fixtures, so this file stays genuinely IN scope with no exclusion
 * and no annotation while the fixtures it feeds the checker are still real.
 */
const TBL = 'table';
const POOLED = `
jest.mock('@/modules/platform/supabase-server', () => {
  const build = (${TBL}: string) => {
    const b = {
      select: () => b,
      update: () => b,
      eq: (col: string, val: unknown) => {
        (mockEqCalls[${TBL}] = mockEqCalls[${TBL}] ?? []).push([col, val]);
        return b;
      },
    };
    return b;
  };
  return { createClient: async () => ({ from: (t: string) => build(t) }) };
});
`;

const PER_STATEMENT = `
jest.mock('@/modules/platform/supabase-server', () => {
  const build = (table: string) => {
    const statement = { table, kind: 'unknown', eq: [] };
    mockStatements.push(statement);
    const b = {
      select: () => { statement.kind = 'select'; return b; },
      update: () => { statement.kind = 'update'; return b; },
      eq: (col: string, val: unknown) => { statement.eq.push([col, val]); return b; },
    };
    return b;
  };
  return { createClient: async () => ({ from: (t: string) => build(t) }) };
});
`;

const FLOOR_PADDING = 12;

describe('CTL-076: the checker itself', () => {
  it('passes its own self-test', () => {
    const r = run(['--self-test']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Self-test passed \(\d+ cases, floor \d+\)/);
  });

  it('is green against the committed baseline', () => {
    const r = run([]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('No new table-keyed .eq() recorders');
  });

  it('the committed baseline is real, and every path in it is still tracked', () => {
    const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, BASELINE_REL), 'utf-8'));
    const entries = Object.entries(baseline.files);
    // catalogue failure mode 4 — assert the corpus before iterating it.
    expect(entries.length).toBeGreaterThan(0);
    for (const [rel, count] of entries) {
      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThan(0);
      const tracked = execFileSync('git', ['ls-files', '--error-unmatch', rel], {
        cwd: ROOT,
        encoding: 'utf-8',
      });
      expect(tracked.trim()).toBe(rel);
    }
  });
});

describe('CTL-076: the shape it exists for', () => {
  it('flags a pooled-per-table .eq() recorder', () => {
    const dir = sandbox({
      files: { 'tests/unit/pooled.test.ts': POOLED },
      baseline: { files: {} },
      padding: FLOOR_PADDING,
    });
    const r = run(['--root', dir, '--min-files', '1', '--min-recorders', '1'], { cwd: dir });
    expect(r.code).toBe(1);
    expect(r.out).toContain('NEW: tests/unit/pooled.test.ts');
  });

  it('does NOT flag a per-statement recorder — the correct shape stays quiet', () => {
    const dir = sandbox({
      files: { 'tests/unit/per-statement.test.ts': PER_STATEMENT },
      baseline: { files: {} },
      padding: FLOOR_PADDING,
    });
    const r = run(['--root', dir, '--min-files', '1', '--min-recorders', '1'], { cwd: dir });
    expect(r.code).toBe(0);
    expect(r.out).toContain('No new table-keyed .eq() recorders');
  });

  it('does not flag a commented-out pooled recorder', () => {
    const dir = sandbox({
      files: {
        'tests/unit/prose.test.ts':
          '// Pooling per table is wrong:\n' +
          `//   eq: (col, val) => { (pool[${TBL}] ??= []).push([col, val]) }\n` +
          `/* the block form is prose too: pool[${TBL}].push(x) */\n` +
          'const o = { eq: (c: string, v: unknown) => { seen.push([c, v]); return o; } };\n',
      },
      baseline: { files: {} },
      padding: FLOOR_PADDING,
    });
    const r = run(['--root', dir, '--min-files', '1', '--min-recorders', '1'], { cwd: dir });
    expect(r.code).toBe(0);
  });
});

describe('CTL-076: the ratchet works in both directions', () => {
  it('a baselined file at the same count passes', () => {
    const dir = sandbox({
      files: { 'tests/unit/pooled.test.ts': POOLED },
      baseline: { files: { 'tests/unit/pooled.test.ts': 1 } },
      padding: FLOOR_PADDING,
    });
    const r = run(['--root', dir, '--min-files', '1', '--min-recorders', '1'], { cwd: dir });
    expect(r.code).toBe(0);
  });

  it('a baselined file that GROWS fails', () => {
    const dir = sandbox({
      files: { 'tests/unit/pooled.test.ts': POOLED + POOLED },
      baseline: { files: { 'tests/unit/pooled.test.ts': 1 } },
      padding: FLOOR_PADDING,
    });
    const r = run(['--root', dir, '--min-files', '1', '--min-recorders', '1'], { cwd: dir });
    expect(r.code).toBe(1);
    expect(r.out).toContain('WORSE');
  });

  it('a baselined file that is FIXED fails as STALE, not silently', () => {
    const dir = sandbox({
      files: { 'tests/unit/pooled.test.ts': PER_STATEMENT },
      baseline: { files: { 'tests/unit/pooled.test.ts': 1 } },
      padding: FLOOR_PADDING,
    });
    const r = run(['--root', dir, '--min-files', '1', '--min-recorders', '1'], { cwd: dir });
    expect(r.code).toBe(1);
    expect(r.out).toContain('STALE');
  });
});

describe('CTL-076: it fails CLOSED rather than reporting a clean scan it never ran', () => {
  it('exits 2 when the baseline is absent', () => {
    // "Absent because I removed it", not "absent because I never added it" —
    // KAN-414 trap 2. The sandbox is built WITH a baseline and it is then
    // deleted, so the assertion stays stable however the fixture is copied.
    const dir = sandbox({
      files: { 'tests/unit/per-statement.test.ts': PER_STATEMENT },
      baseline: { files: {} },
      padding: FLOOR_PADDING,
    });
    fs.rmSync(path.join(dir, BASELINE_REL));
    const r = run(['--root', dir, '--min-files', '1', '--min-recorders', '1'], { cwd: dir });
    expect(r.code).toBe(2);
    expect(r.out).toContain('refusing to');
  });

  it('exits 2 when the baseline is not valid JSON', () => {
    const dir = sandbox({
      files: { 'tests/unit/per-statement.test.ts': PER_STATEMENT },
      baseline: { files: {} },
      padding: FLOOR_PADDING,
    });
    fs.writeFileSync(path.join(dir, BASELINE_REL), '{ not json');
    const r = run(['--root', dir, '--min-files', '1', '--min-recorders', '1'], { cwd: dir });
    expect(r.code).toBe(2);
    expect(r.out).toContain('not valid JSON');
  });

  it('exits 2 when the corpus has collapsed, rather than reporting no findings', () => {
    // The half people forget: "found nothing" and "looked at nothing" produce
    // identical output unless the floor is checked (catalogue failure mode 4).
    const dir = sandbox({
      files: { 'tests/unit/per-statement.test.ts': PER_STATEMENT },
      baseline: { files: {} },
    });
    const r = run(['--root', dir], { cwd: dir });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/tracked test file\(s\) found|contain an \.eq\(\) recorder/);
  });

  it('exits 2 when the root is not a git repository', () => {
    const dir = path.join(tmp, 'not-a-repo');
    fs.mkdirSync(dir, { recursive: true });
    const r = run(['--root', dir], { cwd: dir });
    expect(r.code).toBe(2);
    expect(r.out).toContain('Failing closed');
  });
});

describe('CTL-076: it is registered and invoked', () => {
  it('is wired into pr-checks.yml — a control nothing runs is the SEC-79 failure', () => {
    const wf = fs.readFileSync(path.join(ROOT, SRC.prChecks), 'utf-8');
    expect(wf).toContain(`python3 ${SCRIPT} --self-test`);
    expect(wf).toContain(`python3 ${SCRIPT}\n`);
  });

  it('is registered in controls/registry.json with KAN-459 in prevents', () => {
    const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'controls/registry.json'), 'utf-8'));
    const control = registry.controls.find((c) => c.implementation === SCRIPT);
    expect(control).toBeDefined();
    expect(control.prevents).toContain('KAN-459');
  });
});
