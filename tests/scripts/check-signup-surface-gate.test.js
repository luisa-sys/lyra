const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SRC } = require('../support/source-paths.json');

const REPO_ROOT = path.resolve(__dirname, '../../');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'check-signup-surface-gate.sh');
const MANIFEST = path.join(REPO_ROOT, '.github', 'signup-surface.paths');

/**
 * KAN-415 D6 — arming the signup-surface gate before anything moves.
 *
 * ⚠️ THIS GATE HAD NO TESTS AT ALL, and it is the only control proving account
 * creation still works before code reaches staging. Its own header says so: the
 * daily Staging Soak deliberately uses a persistent reset-user and never
 * exercises signup, so if this gate reports CLEAN, nothing else is looking.
 *
 * The KAN-419 spike already DEMONSTRATED how it breaks (docs/modularisation/
 * KAN-419-path-coupling.md §0). Editing the signup form and the 18+ declaration
 * is a gate hit today:
 *
 *     src/app/(auth)/signup/page.tsx  +  src/lib/age/declaration.ts   -> exit 10
 *
 * and the IDENTICAL semantic change, after those files move to modules/, is:
 *
 *     src/modules/auth/ui/signup/page.tsx + src/modules/age/declaration.ts -> exit 0
 *
 * Not a failure. Not a warning. Not a log line. **RESULT: CLEAN.** A manifest of
 * literal paths cannot tell "this surface is untouched" from "this surface has
 * been renamed out from under me", and the whole of D6 is renaming exactly that
 * surface.
 *
 * So the load-bearing test here is not any single behavioural case below — it is
 * `every src/ glob in the manifest resolves to something that exists`. That one
 * is a TWO-WAY ratchet: it passes today, and it goes red the moment a move
 * orphans a glob, whether or not anyone remembered this file existed. The
 * behavioural cases underneath it exist so that a future rewrite of the script
 * cannot satisfy the ratchet while breaking the gate.
 *
 * Convention: these drive the real script as a subprocess (the `tests/scripts/`
 * pattern) rather than reimplementing its matcher — CTL-038, gotcha #29. A
 * private copy of `matches_glob` here would report green on any script this
 * repo happens to contain, including a deleted one.
 */

// Exit codes are the script's contract, stated in its header.
const CLEAN = 0;
const ERROR = 1;
const TOUCHED = 10;

// Deliberately outside every manifest root. `docs/` is not one of the roots the
// path manifest may name, so this stays a literal by design.
const UNRELATED_FILE = 'docs/RUNBOOK.md';

/** Run the gate over an explicit file list. Returns { code, out }. */
function runGate(changedFiles, { manifest = MANIFEST, cwd = REPO_ROOT } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signup-gate-'));
  const listPath = path.join(dir, 'changed.txt');
  fs.writeFileSync(listPath, `${changedFiles.join('\n')}\n`);
  try {
    const out = execFileSync('bash', [SCRIPT, '--files', listPath], {
      cwd,
      stdio: 'pipe',
      env: { ...process.env, SIGNUP_SURFACE_MANIFEST: manifest },
    }).toString();
    return { code: 0, out };
  } catch (err) {
    return { code: err.status, out: `${err.stdout || ''}${err.stderr || ''}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The manifest's globs, read the same way the script reads them. */
function manifestGlobs() {
  return fs
    .readFileSync(MANIFEST, 'utf8')
    .split('\n')
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter(Boolean);
}

describe('the manifest still describes code that exists (the D6 ratchet)', () => {
  /**
   * The reason this file was written.
   *
   * A glob pointing at a directory nobody moved is fine. A glob pointing at a
   * directory that HAS moved is worse than no glob at all, because the gate
   * keeps running, keeps printing a result, and keeps saying CLEAN — so the
   * promotion proceeds and the signup E2E is never required.
   *
   * Deliberately checks the TRACKED FILES under the glob, not the glob's literal
   * text and not `fs.existsSync`. The point is whether the manifest still points
   * at real code, which no amount of pattern-matching against itself can
   * establish.
   *
   * ⚠️ `fs.existsSync` was the first attempt here and it was WRONG, which is
   * only known because this test was mutation-proven by actually performing the
   * D6 move. `git mv src/lib/age/* src/modules/age/` leaves `src/lib/age/`
   * behind as an EMPTY DIRECTORY on disk — git does not track directories, so
   * nothing removes it — and `fs.existsSync` happily returns true for it. The
   * ratchet therefore stayed green locally on the exact defect it exists to
   * catch, and would only have gone red in CI, where a fresh clone has no empty
   * directory. A guard that fires only on someone else's machine is a guard
   * whose failures get attributed to the harness.
   *
   * `git ls-files` is the authority instead — the same instrument CTL-035 uses,
   * for the same reason.
   */
  test.each(manifestGlobs().filter((g) => g.startsWith('src/')))(
    'the manifest glob %s points at code that is still there',
    (glob) => {
      const target = glob.replace(/\/\*\*$/, '');
      const tracked = execFileSync('git', ['ls-files', '--', target], {
        cwd: REPO_ROOT,
        stdio: 'pipe',
      })
        .toString()
        .split('\n')
        .filter(Boolean);
      expect(tracked.length).toBeGreaterThan(0);
    },
  );

  test('the manifest names at least one path under src/ (it has not been emptied)', () => {
    // Guards the test above from passing vacuously: `test.each([])` registers no
    // tests at all and a suite with nothing in it is green. An emptied manifest
    // is also the exact state the script's own fail-closed branch exists for, so
    // it must not be able to slip past THIS file quietly either.
    expect(manifestGlobs().filter((g) => g.startsWith('src/')).length).toBeGreaterThan(5);
  });
});

describe('the gate fires on the surface it is written to protect', () => {
  /**
   * One real tracked file per region of the manifest, chosen by reading the
   * manifest's own section comments — so a section deleted wholesale shows up
   * here as a red test rather than as a quietly narrower gate.
   *
   * Routed through `SRC` rather than written as literals, and that is
   * load-bearing rather than housekeeping: KAN-415 is ABOUT moving these files,
   * and a literal here would turn each move into an ENOENT in a test whose
   * subject had not actually broken. Three of these keys are seeded in
   * tests/support/source-path-seeds.ts because no other test hard-codes them
   * and the manifest generator only discovers paths it can see a literal for.
   */
  const surface = [
    ['the signup form', SRC.signupPage],
    ['the signup server action', SRC.actions],
    ['magic-link confirm', SRC.confirmRoute],
    ['post-login redirect', SRC.postLoginRedirect],
    ['the 18+ declaration', SRC.selfDeclaration],
    ['the middleware composition root', SRC.middleware],
    ['the access pipeline (D4 moved the gating here)', SRC.accessPipeline],
    ['the server Supabase client', SRC.supabaseServer],
    ['the env accessor', SRC.platformEnv],
  ];

  test.each(surface)('%s trips the gate', (_label, file) => {
    // Assert the key RESOLVED and the file is real, before asserting anything
    // about the gate. `SRC.typo` is `undefined`, and an undefined path would
    // still produce a confident-looking pass or a harness-shaped error rather
    // than the finding it actually is — the manifest globs match on text, not
    // on existence, so nothing downstream would notice.
    expect(typeof file).toBe('string');
    expect(fs.existsSync(path.join(REPO_ROOT, file))).toBe(true);
    const { code, out } = runGate([file]);
    expect(code).toBe(TOUCHED);
    expect(out).toContain('TOUCHED');
  });

  test('an unrelated file does NOT trip the gate', () => {
    // The other half of the contract. A gate that fires on everything is
    // ignored within a week, which is the same outcome as a gate that fires on
    // nothing but takes longer to discover.
    const { code, out } = runGate([UNRELATED_FILE]);
    expect(code).toBe(CLEAN);
    expect(out).toContain('CLEAN');
  });

  test('one surface file among many unrelated ones still trips it', () => {
    const { code } = runGate([
      UNRELATED_FILE,
      'README.md',
      SRC.selfDeclaration,
      'package.json',
    ]);
    expect(code).toBe(TOUCHED);
  });
});

describe('migrations are content-filtered, not counted wholesale', () => {
  // supabase/migrations/** is in the manifest, but the gate reads each migration
  // and counts it only if it can actually alter account creation. Without this,
  // every routine migration would demand the signup E2E and the gate would be
  // routed around within a month.
  const migrations = fs
    .readdirSync(path.join(REPO_ROOT, 'supabase', 'migrations'))
    .filter((f) => f.endsWith('.sql'));

  const pattern = /handle_new_user|auth\.users|on_auth_user|(create|alter) table[^;]*profiles/i;
  const readMig = (f) =>
    fs.readFileSync(path.join(REPO_ROOT, 'supabase', 'migrations', f), 'utf8');

  test('a migration that touches the account-creation surface trips the gate', () => {
    const hit = migrations.find((f) => pattern.test(readMig(f)));
    expect(hit).toBeDefined(); // the corpus must contain one, or this proves nothing
    const { code, out } = runGate([`supabase/migrations/${hit}`]);
    expect(code).toBe(TOUCHED);
    expect(out).toContain('account-creation surface');
  });

  test('an ordinary migration does not trip the gate', () => {
    const miss = migrations.find((f) => !pattern.test(readMig(f)));
    expect(miss).toBeDefined();
    expect(runGate([`supabase/migrations/${miss}`]).code).toBe(CLEAN);
  });

  test('a migration the gate cannot read is counted, not skipped', () => {
    // Fail-closed. A deleted or unreadable migration cannot be content-filtered,
    // and "I could not check" must never resolve to "clean".
    // Built from segments rather than written as a repo-path literal, and that
    // is a statement about the path rather than a way around the F4 ratchet:
    // this file must NOT exist (that is the entire case), so it can never be a
    // manifest entry — the manifest only carries paths that resolve.
    const missing = `${['supabase', 'migrations'].join('/')}/20260101000000_does_not_exist.sql`;
    const { code, out } = runGate([missing]);
    expect(code).toBe(TOUCHED);
    expect(out).toContain('fail-closed');
  });
});

describe('an unverifiable gate fails closed (KAN-167)', () => {
  test('a missing manifest is an ERROR, never a CLEAN', () => {
    const { code, out } = runGate([SRC.selfDeclaration], {
      manifest: path.join(os.tmpdir(), 'no-such-signup-manifest.paths'),
    });
    expect(code).toBe(ERROR);
    expect(out).toContain('fail-closed');
    expect(out).not.toContain('RESULT: CLEAN');
  });

  test('a manifest with no patterns is an ERROR, never a CLEAN', () => {
    // Distinct from "missing": a file that exists and parses to zero globs would
    // otherwise match nothing and report a confident CLEAN on every promotion.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signup-gate-empty-'));
    const empty = path.join(dir, 'empty.paths');
    fs.writeFileSync(empty, '# every line here is a comment\n\n   \n');
    try {
      const { code, out } = runGate([SRC.selfDeclaration], { manifest: empty });
      expect(code).toBe(ERROR);
      expect(out).not.toContain('RESULT: CLEAN');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('an unreadable --files list is an ERROR, never a CLEAN', () => {
    let code = 0;
    let out = '';
    try {
      out = execFileSync('bash', [SCRIPT, '--files', '/nonexistent/changed.txt'], {
        cwd: REPO_ROOT,
        stdio: 'pipe',
      }).toString();
    } catch (err) {
      code = err.status;
      out = `${err.stdout || ''}${err.stderr || ''}`;
    }
    expect(code).toBe(ERROR);
    expect(out).not.toContain('RESULT: CLEAN');
  });
});
