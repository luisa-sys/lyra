/**
 * KAN-475 / CTL-070 — the SRC manifest's key IDENTITY is pinned.
 *
 * The manifest guards that existed before this control answer "does every key
 * resolve to a tracked file?". They cannot answer "does this key still mean
 * what it meant?", and after a repoint every key still resolves — so the
 * dangerous case passes them by construction.
 *
 * MEASURED, not assumed. `git mv src/modules/access/pipeline.ts` to a new name
 * plus a regeneration makes `SRC.pipeline` flip from the access pipeline to the
 * recommender one. Two existing cases DID go red — but for two OTHER reasons:
 * `SRC.v2Pipeline` vanished and a test names it, and the moved path happens to
 * be seeded. The case `SRC.pipeline is defined and points at a tracked file`
 * PASSED throughout. Where the counterpart key is neither referenced by name
 * nor seeded, nothing in the estate reddens at all.
 *
 * These cases drive the real script as a subprocess (the `tests/scripts/`
 * convention) rather than reimplementing its comparison — catalogue failure
 * mode 1.
 *
 * Fixture paths below are BUILT rather than written as literals. The F4
 * shrink-only ratchet counts raw `src/...` literals in tests, and a new suite
 * that raised it — even with throwaway fixture strings — is how a ratchet
 * decays into the suppression list it replaced.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { SRC } = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'tests/support/source-paths.json'), 'utf-8'),
);
const CHECKER = SRC.checkSourcePathIdentity;

// Not routed through SRC: the manifest only harvests literals under src/,
// supabase/, scripts/, public/, design/ and .github/, so a tests/support path
// can never have a key. It is also outside what the raw-literal ratchet counts,
// so naming it here costs nothing.
const LOCK_REL = 'tests/support/source-path-identity.json';
const REGISTRY_REL = 'controls/registry.json';

/** Synthetic fixture paths, assembled so no raw repo-path literal appears. */
const fixture = (name) => ['src', name].join('/');

/** Run the checker, returning its exit code and combined output. */
function run(args = []) {
  try {
    const stdout = execFileSync('python3', [CHECKER, ...args], {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out: stdout };
  } catch (err) {
    return { code: err.status, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

describe('CTL-070 — SRC key identity lock', () => {
  test('the manifest itself routes to the checker', () => {
    // If this key were missing, every case below would run `python3 undefined`
    // and fail for a reason unrelated to what it asserts (gotcha #31).
    expect(typeof CHECKER).toBe('string');
    expect(fs.existsSync(path.join(ROOT, CHECKER))).toBe(true);
  });

  test('the checker self-test passes', () => {
    const r = run(['--self-test']);
    expect(r.out).toMatch(/Self-test passed \(\d+ cases, floor \d+\)/);
    expect(r.code).toBe(0);
  });

  test('the self-test prints no CI annotation while passing', () => {
    // A `::error::` line lands in the run summary whatever the exit code, so a
    // green step emitting a dozen of them would be standing noise on a gate —
    // which is how people learn to wave one through.
    expect(run(['--self-test']).out).not.toContain('::error::');
  });

  test('the committed manifest and lock agree on the real tree', () => {
    const r = run([]);
    expect(r.out).toMatch(/identity is intact/);
    expect(r.code).toBe(0);
  });

  test('the lock is a real corpus, not a token file', () => {
    // A lock with three entries would pass every case above while pinning
    // almost nothing (catalogue failure mode 4).
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, LOCK_REL), 'utf-8'));
    expect(Object.keys(lock.keys).length).toBeGreaterThan(100);
    expect(lock.count).toBe(Object.keys(lock.keys).length);
  });

  test('the lock covers exactly the manifest keys, with identical values', () => {
    // An INDEPENDENT oracle: the comparison is made here from the two JSON
    // files rather than by asking the subject whether it agrees with itself
    // (catalogue failure mode 10).
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, LOCK_REL), 'utf-8'));
    expect(Object.keys(lock.keys).sort()).toEqual(Object.keys(SRC).sort());
    for (const [key, value] of Object.entries(SRC)) {
      expect({ key, value: lock.keys[key] }).toEqual({ key, value });
    }
  });

  describe('the verdicts', () => {
    let dir;
    let manifest;
    let lockFile;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srcid-'));
      manifest = path.join(dir, 'manifest.json');
      lockFile = path.join(dir, 'lock.json');
    });

    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    const writePair = (manifestKeys, lockKeys) => {
      fs.writeFileSync(manifest, JSON.stringify({ SRC: manifestKeys }));
      fs.writeFileSync(
        lockFile,
        JSON.stringify({ count: Object.keys(lockKeys).length, keys: lockKeys }),
      );
    };

    const check = (extra = []) =>
      run([...extra, '--manifest', manifest, '--lock', lockFile]);

    test('a key whose VALUE changed fails, naming both paths', () => {
      // The KAN-475 scenario with the two files it actually happened to: one
      // moves, and a key belonging to a file that did NOT move changes meaning.
      writePair({ pipeline: SRC.v2Pipeline }, { pipeline: SRC.pipeline });
      const r = check();
      expect(r.code).toBe(1);
      expect(r.out).toContain('changed MEANING');
      expect(r.out).toContain(SRC.pipeline);
      expect(r.out).toContain(SRC.v2Pipeline);
    });

    test('an unchanged pair stays green — the gate does not always fire', () => {
      const same = { a: fixture('a.ts'), b: fixture('b.ts') };
      writePair({ ...same }, { ...same });
      expect(check().code).toBe(0);
    });

    test('--write refuses to absorb a repoint, and writes nothing', () => {
      writePair({ pipeline: fixture('new.ts') }, { pipeline: fixture('old.ts') });
      const before = fs.readFileSync(lockFile, 'utf-8');
      const r = check(['--write']);
      expect(r.code).toBe(1);
      expect(r.out).toContain('Refusing to absorb');
      expect(fs.readFileSync(lockFile, 'utf-8')).toBe(before);
    });

    test('--write absorbs a repoint only when the key is NAMED', () => {
      writePair({ pipeline: fixture('new.ts') }, { pipeline: fixture('old.ts') });
      const r = check(['--write', '--accept-repoint=pipeline']);
      expect(r.code).toBe(0);
      expect(JSON.parse(fs.readFileSync(lockFile, 'utf-8')).keys.pipeline).toBe(
        fixture('new.ts'),
      );
    });

    test('naming a DIFFERENT key does not absorb the repoint', () => {
      // Otherwise --accept-repoint degrades into a blanket --force.
      writePair({ pipeline: fixture('new.ts') }, { pipeline: fixture('old.ts') });
      expect(check(['--write', '--accept-repoint=somethingElse']).code).toBe(1);
    });

    test('a lock stale in EITHER direction fails', () => {
      writePair({ a: fixture('a.ts'), c: fixture('c.ts') }, { a: fixture('a.ts') });
      expect(check().code).toBe(1);

      writePair({ a: fixture('a.ts') }, { a: fixture('a.ts'), z: fixture('z.ts') });
      const r = check();
      expect(r.code).toBe(1);
      expect(r.out).toContain('STALE');
    });

    test('a plain --write absorbs staleness, so nobody reaches for --accept-repoint by reflex', () => {
      writePair({ a: fixture('a.ts'), c: fixture('c.ts') }, { a: fixture('a.ts') });
      expect(check(['--write']).code).toBe(0);
      expect(check().code).toBe(0);
    });

    test('a missing lock fails CLOSED on the verifying path', () => {
      // "Absent because nobody wrote it" and "absent because someone deleted
      // it" are the same file state, and only one is safe to call clean — so
      // the verifying path never treats absence as agreement.
      fs.writeFileSync(manifest, JSON.stringify({ SRC: { a: fixture('a.ts') } }));
      const r = check();
      expect(r.code).toBe(2);
      expect(r.out).toContain('Failing closed');
    });

    test('an empty manifest fails closed rather than agreeing vacuously', () => {
      writePair({}, { a: fixture('a.ts') });
      expect(check().code).toBe(2);
    });

    test('--accept-repoint without --write is refused', () => {
      const same = { a: fixture('a.ts') };
      writePair({ ...same }, { ...same });
      expect(check(['--accept-repoint=a']).code).toBe(2);
    });
  });

  test('`npm run gen:test-paths` must NOT maintain the lock', () => {
    // The whole value of the lock is that writing it is a separate, deliberate
    // act. A lock the generator refreshes is the manifest again, and the
    // control would then agree with itself forever.
    const lockPath = path.join(ROOT, LOCK_REL);
    const before = fs.readFileSync(lockPath, 'utf-8');
    execFileSync('node', [SRC.genTestPaths], { cwd: ROOT, stdio: 'ignore' });
    expect(fs.readFileSync(lockPath, 'utf-8')).toBe(before);
  });

  test('the control is registered and wired into CI', () => {
    // SEC-79: a control nothing invokes reports green forever.
    const registry = JSON.parse(
      fs.readFileSync(path.join(ROOT, REGISTRY_REL), 'utf-8'),
    );
    const entry = registry.controls.find((c) => c.id === 'CTL-070');
    expect(entry).toBeDefined();
    expect(entry.implementation).toBe(CHECKER);
    expect(entry.prevents).toContain('KAN-475');

    const prChecks = fs.readFileSync(path.join(ROOT, SRC.prChecks), 'utf-8');
    expect(prChecks).toContain(CHECKER);
  });
});
