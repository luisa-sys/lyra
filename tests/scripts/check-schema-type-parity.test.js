/**
 * KAN-414 F6 — tests for scripts/check-schema-type-parity.py (CTL-036).
 *
 * The destructive cases mutate a COPY of the schema files in a temp dir and
 * point the script at it, rather than editing the committed ones: several
 * other suites read `src/types/`, and Jest runs test files in parallel.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SRC } = require('../support/source-paths.json');

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT_REL = SRC.checkSchemaTypeParity;
const SCRIPT = path.join(ROOT, SCRIPT_REL);

function runAt(scriptPath, args = [], cwd = ROOT) {
  try {
    const stdout = execFileSync('python3', [scriptPath, ...args], {
      encoding: 'utf-8',
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, exitCode: 0 };
  } catch (err) {
    return { stdout: err.stdout ?? '', exitCode: err.status ?? 1 };
  }
}

const run = (args = []) => runAt(SCRIPT, args);

/**
 * A disposable copy of everything the gate reads, so a mutation cannot touch
 * the committed schemas or race another worker.
 */
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-parity-'));
  fs.mkdirSync(path.join(dir, SRC.database), { recursive: true });
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'supabase'), { recursive: true });
  for (const env of ['dev', 'staging', 'prod']) {
    fs.copyFileSync(
      path.join(ROOT, `src/types/database/${env}.ts`),
      path.join(dir, `src/types/database/${env}.ts`),
    );
  }
  fs.copyFileSync(
    path.join(ROOT, SRC.schemaDriftBaseline),
    path.join(dir, SRC.schemaDriftBaseline),
  );
  // The script resolves its repo root from __file__, so copying it in is what
  // repoints it at the sandbox.
  fs.copyFileSync(SCRIPT, path.join(dir, SCRIPT_REL));
  return { dir, script: path.join(dir, SCRIPT_REL) };
}

describe('check-schema-type-parity.py', () => {
  test('self-test passes', () => {
    const r = run(['--self-test']);
    expect(r.stdout).toMatch(/self-test: \d+\/\d+ passed/);
    expect(r.stdout).not.toMatch(/FAIL/);
    expect(r.exitCode).toBe(0);
  });

  test('an enum losing a label is ONE fact, not sixteen lines', () => {
    // The specific noise problem that makes a line-diff gate unreadable, and
    // therefore ignorable. Pinned so nobody "simplifies" back to a line diff.
    const r = run(['--self-test']);
    expect(r.stdout).toMatch(/ok +enum label loss is exactly one fact despite reformatting/);
  });

  test('the committed schemas match the recorded baseline exactly', () => {
    const r = run();
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/All drift is known, ticketed and unchanged\./);
  });

  test('every known drift is attributed to a ticket', () => {
    const r = run();
    // The summary groups by ticket; an "untracked" bucket would mean drift got
    // into the baseline without an owner.
    expect(r.stdout).toMatch(/Schema drift: \d+ differing declarations/);
    expect(r.stdout).not.toMatch(/untracked/);
    expect(r.stdout).toMatch(/SEC-107/);
    expect(r.stdout).toMatch(/BUGS-62/);
  });

  test('--show works without a baseline, so a baseline can be bootstrapped', () => {
    const { dir, script } = sandbox();
    try {
      fs.rmSync(path.join(dir, SRC.schemaDriftBaseline));
      const r = runAt(script, ['--show'], dir);
      expect(r.exitCode).toBe(0);
      expect(() => JSON.parse(r.stdout)).not.toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('NEW, unrecorded drift fails with exit 1 and names the fact', () => {
    const { dir, script } = sandbox();
    try {
      const prod = path.join(dir, SRC.prod);
      fs.writeFileSync(
        prod,
        fs.readFileSync(prod, 'utf-8').replace('          is_suspended: boolean\n', ''),
      );
      const r = runAt(script, [], dir);
      expect(r.exitCode).toBe(1);
      expect(r.stdout).toMatch(/NEW schema drift/);
      expect(r.stdout).toMatch(/column:profiles\.is_suspended/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('drift that has been RESOLVED also fails — the baseline must shrink', () => {
    // The rule that turns a suppression list into a ratchet. If this ever goes
    // green, the baseline can permanently over-state the problem and nobody
    // will notice the day it is actually fixed.
    const { dir, script } = sandbox();
    try {
      const prod = path.join(dir, SRC.prod);
      fs.writeFileSync(
        prod,
        fs.readFileSync(prod, 'utf-8').replace(
          '          is_suspended: boolean\n',
          '          is_suspended: boolean\n          phone_search_hash: string | null\n',
        ),
      );
      const r = runAt(script, [], dir);
      expect(r.exitCode).toBe(1);
      expect(r.stdout).toMatch(/no longer drifting/);
      expect(r.stdout).toMatch(/phone_search_hash/);
      expect(r.stdout).toMatch(/keeps shrinking/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a MISSING schema file exits 2, not 0 and not 1', () => {
    const { dir, script } = sandbox();
    try {
      fs.rmSync(path.join(dir, SRC.staging));
      const r = runAt(script, [], dir);
      expect(r.exitCode).toBe(2);
      expect(r.exitCode).not.toBe(0);
      expect(r.exitCode).not.toBe(1);
      expect(r.stdout).toMatch(/Failing closed/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a schema file that is not a generated schema exits 2', () => {
    // "It parsed as a file" is not "it is the thing we must diff". An empty or
    // wrong file yielding zero facts would otherwise read as perfect parity.
    const { dir, script } = sandbox();
    try {
      fs.writeFileSync(path.join(dir, SRC.prod), '// oops\n');
      const r = runAt(script, [], dir);
      expect(r.exitCode).toBe(2);
      expect(r.stdout).toMatch(/does not declare `export type Database`/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('an unparseable baseline exits 2', () => {
    const { dir, script } = sandbox();
    try {
      fs.writeFileSync(path.join(dir, SRC.schemaDriftBaseline), '{ not json');
      const r = runAt(script, [], dir);
      expect(r.exitCode).toBe(2);
      expect(r.stdout).toMatch(/not valid JSON/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the committed Database types', () => {
  test('all three schemas exist and declare Database', () => {
    for (const env of ['dev', 'staging', 'prod']) {
      const p = path.join(ROOT, `src/types/database/${env}.ts`);
      expect(fs.existsSync(p)).toBe(true);
      expect(fs.readFileSync(p, 'utf-8')).toMatch(/export type Database/);
    }
  });

  test('generated schemas carry no hand-written header', () => {
    // They must stay byte-identical to the generator output so a regeneration
    // diff is signal. A header would appear in every regeneration and teach a
    // reviewer to skim.
    for (const env of ['dev', 'staging', 'prod']) {
      const src = fs.readFileSync(path.join(ROOT, `src/types/database/${env}.ts`), 'utf-8');
      expect(src.startsWith('export type Json')).toBe(true);
    }
  });

  test('the app imports the schema through the index, not a specific environment', () => {
    // The indirection is what lets F7 change the canonical target in one line.
    const index = fs.readFileSync(path.join(ROOT, SRC.index), 'utf-8');
    expect(index).toMatch(/export type \{ Database, Json \} from '\.\/dev'/);
  });
});
