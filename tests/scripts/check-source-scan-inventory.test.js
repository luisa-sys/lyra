/**
 * CTL-077 / KAN-356 §C — the source-scan inventory ratchet.
 *
 * Every assertion here drives the REAL script as a subprocess and reads its
 * exit code and output. Nothing reimplements the classifier, and nothing
 * asserts on the script's source text — a suite that grepped the control it
 * polices would be the exact defect CTL-038 exists for, and would also make
 * this file its own inventory entry.
 *
 * Fixtures are assembled in a temp directory at runtime rather than committed,
 * so this file stays genuinely in scope of every sibling control with no
 * exclusion and no annotation (the CTL-061 lesson: an excluded file is a file
 * the control has stopped covering).
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO, 'scripts', 'check-source-scan-inventory.py');
const BASELINE = path.join(
  REPO,
  'tests',
  'support',
  'source-scan-inventory-baseline.json',
);

/**
 * Run the control, returning its exit code and combined output.
 *
 * The script derives its repo root from its OWN location, so a sandbox run
 * must invoke the sandbox's copy — passing the real script with a different
 * cwd would silently measure the real estate instead, and every sandbox
 * assertion below would be answering a question about `develop`.
 */
function run(args = [], cwd = REPO) {
  const script = path.join(cwd, 'scripts', path.basename(SCRIPT));
  try {
    const stdout = execFileSync('python3', [script, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out: stdout };
  } catch (err) {
    return {
      code: err.status,
      out: `${err.stdout || ''}${err.stderr || ''}`,
    };
  }
}

describe('CTL-077 — source-scan inventory is a two-way ratchet', () => {
  test('the control exists and is executable by the same path CI invokes', () => {
    expect(fs.existsSync(SCRIPT)).toBe(true);
  });

  test('its own self-test passes', () => {
    const r = run(['--self-test']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Self-test passed');
  });

  test('develop is clean against the committed baseline', () => {
    const r = run([]);
    expect(r.code).toBe(0);
  });

  test('the baseline is real, non-empty and structurally sound', () => {
    const data = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    // Failure mode 4: a ratchet over an empty corpus is green forever.
    expect(Object.keys(data.files).length).toBeGreaterThan(50);
    expect(data._totals.files).toBe(Object.keys(data.files).length);
    expect(data._totals.blocks).toBe(
      Object.values(data.files).reduce((a, b) => a + b, 0),
    );
    // Every counted entry is positive — a zero would be an entry that can
    // never fail as GROWN from below and can never go STALE.
    for (const n of Object.values(data.files)) {
      expect(n).toBeGreaterThan(0);
    }
  });

  test('every baselined file is still tracked in git', () => {
    const data = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    const tracked = new Set(
      execFileSync('git', ['-C', REPO, 'ls-files', 'tests'], {
        encoding: 'utf8',
      })
        .split('\n')
        .filter(Boolean),
    );
    const dangling = Object.keys(data.files).filter((f) => !tracked.has(f));
    expect(dangling).toEqual([]);
  });
});

describe('CTL-077 — behaviour under mutation', () => {
  /**
   * Build a throwaway repo containing the control, the classifier it imports,
   * a tests/ tree and a baseline. This lets the ratchet be driven in both
   * directions without touching the real estate.
   */
  function sandbox(files, baselineFiles) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctl077-'));
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'tests', 'support'), { recursive: true });
    fs.copyFileSync(SCRIPT, path.join(dir, 'scripts', path.basename(SCRIPT)));
    fs.copyFileSync(
      path.join(REPO, 'scripts', 'triage-source-text-tests.py'),
      path.join(dir, 'scripts', 'triage-source-text-tests.py'),
    );
    for (const [rel, body] of Object.entries(files)) {
      fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), body);
    }
    // git ls-files only sees tracked content, so the sandbox must be a repo.
    const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore' });
    git('init', '-q');
    git('config', 'user.email', 'ctl077@test.local');
    git('config', 'user.name', 'ctl077');
    git('add', '-A');
    git('commit', '-qm', 'fixture');
    if (baselineFiles !== undefined) {
      fs.writeFileSync(
        path.join(dir, 'tests', 'support', 'source-scan-inventory-baseline.json'),
        JSON.stringify({ files: baselineFiles }, null, 2),
      );
    }
    return dir;
  }

  const SCAN = `
  test('a', () => {
    const s = readFileSync(p, 'utf8');
    expect(s).toContain('isSuspended');
  });
`;

  test('a NEW source scan fails the build', () => {
    const dir = sandbox({ 'tests/unit/a.test.js': SCAN }, {});
    const r = run([], dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain('NEW');
    expect(r.out).toContain('tests/unit/a.test.js');
  });

  test('a GROWN count fails the build', () => {
    const dir = sandbox({ 'tests/unit/a.test.js': SCAN + SCAN }, { 'tests/unit/a.test.js': 1 });
    const r = run([], dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain('GROWN');
  });

  test('an IMPROVED count fails as STALE — the half that stops it becoming a suppression list', () => {
    const dir = sandbox({ 'tests/unit/a.test.js': SCAN }, { 'tests/unit/a.test.js': 2 });
    const r = run([], dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain('STALE');
  });

  test('one file improving does not net out another regressing', () => {
    const dir = sandbox(
      { 'tests/unit/a.test.js': SCAN, 'tests/unit/b.test.js': SCAN + SCAN + SCAN },
      { 'tests/unit/a.test.js': 2, 'tests/unit/b.test.js': 2 },
    );
    const r = run([], dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain('STALE');
    expect(r.out).toContain('GROWN');
  });

  test('structural scans are not counted — absence, existence, migration', () => {
    const dir = sandbox(
      {
        'tests/unit/a.test.js': `
  test('a', () => { const s = readFileSync(p); expect(s).not.toContain('x'); });
  test('b', () => { expect(existsSync(p)).toBe(true); });
  test('c', () => { const sql = readFileSync(p); expect(sql).toContain('enable row level security'); });
`,
      },
      {},
    );
    const r = run([], dir);
    expect(r.code).toBe(0);
  });

  test('the annotation opts a file out, and needs no baseline entry', () => {
    const dir = sandbox(
      { 'tests/unit/a.test.js': `// source-scan-ok: KAN-356 structural\n${SCAN}` },
      {},
    );
    const r = run([], dir);
    expect(r.code).toBe(0);
  });

  test('a missing baseline fails CLOSED (exit 2), never clean', () => {
    const dir = sandbox({ 'tests/unit/a.test.js': SCAN }, undefined);
    const r = run([], dir);
    expect(r.code).toBe(2);
    expect(r.out).toContain('Failing closed');
  });

  test('an unreadable baseline fails CLOSED, not clean', () => {
    const dir = sandbox({ 'tests/unit/a.test.js': SCAN }, {});
    fs.writeFileSync(
      path.join(dir, 'tests', 'support', 'source-scan-inventory-baseline.json'),
      '{ not json',
    );
    const r = run([], dir);
    expect(r.code).toBe(2);
  });

  test('a baseline with no `files` key fails CLOSED rather than reading as empty', () => {
    const dir = sandbox({ 'tests/unit/a.test.js': SCAN }, undefined);
    fs.writeFileSync(
      path.join(dir, 'tests', 'support', 'source-scan-inventory-baseline.json'),
      JSON.stringify({ totals: 0 }),
    );
    const r = run([], dir);
    expect(r.code).toBe(2);
  });

  test('an empty corpus fails CLOSED — a ratchet over nothing is green forever', () => {
    const dir = sandbox({ 'docs/readme.md': 'no tests here' }, {});
    const r = run([], dir);
    expect(r.code).toBe(2);
    expect(r.out).toContain('corpus is empty');
  });

  test('--write-baseline regenerates, and the gate then passes', () => {
    const dir = sandbox({ 'tests/unit/a.test.js': SCAN }, {});
    expect(run([], dir).code).toBe(1);
    expect(run(['--write-baseline'], dir).code).toBe(0);
    expect(run([], dir).code).toBe(0);
  });
});
