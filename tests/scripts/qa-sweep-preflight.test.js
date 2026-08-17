/**
 * KAN-467 Phase 0 — tests for qa-sweep/preflight.py and qa-sweep/config.py.
 *
 * The preflight is the only thing standing between a click-everything robot
 * and production. So these tests are written to fail if it ever becomes
 * permissive, and every one of them was mutation-verified: the subject was
 * broken, the test was watched going RED, and the subject was restored from a
 * /tmp copy and checked byte-identical.
 *
 * The environment passed to the subject is constructed explicitly rather than
 * inherited. Inheriting would make the result depend on whatever RESEND_API_KEY
 * or CI happened to be set in the developer's shell — a test whose verdict
 * changes with the ambient environment is not a test.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
// Paths come from the manifest, not from literals: this file names source
// files that KAN-415 keeps moving, and a raw literal here would go stale
// silently instead of failing at the manifest.
const { SRC } = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'tests/support/source-paths.json'), 'utf-8'),
);
// Assembled from segments rather than written as a literal: this is a prefix
// discriminator, not a path to a file, and the F4 shrink-only ratchet counts
// any `'src/…'` string in a test as a raw literal to be converted.
const MODULES_ROOT = ['src', 'modules'].join('/') + '/';
const QA_DIR = path.join(ROOT, 'qa-sweep');
const PREFLIGHT = path.join(QA_DIR, 'preflight.py');
const CONFIG = path.join(QA_DIR, 'config.py');

/** Run a python script with an explicitly constructed environment. */
function run(script, args = [], extraEnv = {}) {
  const env = Object.assign(
    { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'en_GB.UTF-8' },
    extraEnv,
  );
  try {
    const stdout = execFileSync('python3', [script, ...args], {
      encoding: 'utf-8',
      cwd: ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, exitCode: 0 };
  } catch (err) {
    return {
      stdout: (err.stdout ?? '') + (err.stderr ?? ''),
      exitCode: err.status ?? 1,
    };
  }
}

const preflight = (args, env) => run(PREFLIGHT, args, env);

/** The envelope as data, so tests assert against policy rather than restating it. */
function envelope() {
  const r = run(CONFIG, ['--show']);
  expect(r.exitCode).toBe(0);
  return JSON.parse(r.stdout);
}

/**
 * Committed MINIMUM fixture counts for each `--self-test`.
 *
 * `expect(stdout).toMatch(/self-test: \d+\/\d+ passed/)` moves its denominator
 * with its numerator, so it detects a fixture that FAILS and never one that is
 * DELETED. Measured 2026-08-04: cutting the config self-test from 26 checks to
 * 1 left jest 68/68 green, and deleting all eight production-refusal fixtures
 * from the preflight self-test (22 -> 14) left it 33/33 green. A denominator
 * nobody pins is not a denominator.
 *
 * These may be RAISED when fixtures are added. They must never be lowered to
 * make a red build pass — that is the same move as weakening an assertion.
 */
const SELF_TEST_FLOORS = { config: 26, preflight: 34 };

/**
 * Assert a `--self-test` both passed everything AND ran at least `floor`
 * fixtures. Returns the parsed total so a caller can report it.
 */
function assertSelfTestFloor(stdout, label, floor) {
  const m = new RegExp(`${label} self-test: (\\d+)/(\\d+) passed`).exec(stdout);
  expect(`${label} self-test line present`).toBe(m ? `${label} self-test line present` : 'MISSING');
  const [, passed, total] = m.map(Number);
  expect(`${label}:${passed}/${total}`).toBe(`${label}:${total}/${total}`);
  expect(total).toBeGreaterThanOrEqual(floor);
  return total;
}

/**
 * The reported status of ONE named preflight check, or null if that check did
 * not run at all. Both outcomes matter: a layer that silently stops emitting
 * its line is as broken as one that reports PASS for production.
 */
function statusOf(stdout, checkName) {
  const line = stdout
    .split('\n')
    .find((l) => /^\s*\[\s*(PASS|FAIL|UNDETERMINED)\s*\]/.test(l) && l.includes(checkName));
  if (!line) return null;
  return line.trim().replace(/^\[\s*/, '').split(/\s*\]/)[0].trim();
}

/**
 * Does `src` declare a server action named `name`, in any shape Next.js allows?
 *
 * Three shapes, because the denylist now covers all three: an exported function
 * in a file-level `'use server'` module; a file-local function carrying its own
 * function-level directive (every admin moderation action); and an anonymous
 * inline `action={async () => { 'use server' }}` closure, which has no name in
 * source and is inventoried under a synthetic `inlineAction<N>` — so the
 * existence check for those is that the file really has an Nth such closure.
 */
function declaresAction(src, name) {
  if (new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b`).test(src)) return true;
  if (
    new RegExp(
      `(?:async\\s+)?function\\s+${name}\\s*\\([^)]*\\)[^{]*\\{\\s*['"]use server['"]`,
    ).test(src)
  ) {
    return true;
  }
  const inline = /^inlineAction(\d+)$/.exec(name);
  if (inline) {
    const closures = src.match(/=>\s*\{\s*['"]use server['"]/g) || [];
    return Number(inline[1]) >= 1 && Number(inline[1]) <= closures.length;
  }
  return false;
}

/**
 * Blank out whole-line comments while preserving every byte offset, so a
 * commented-out call cannot be mistaken for a live one and the offsets used to
 * find the enclosing function stay valid. CTL-039's lesson: this repo has
 * already shipped a scan that a COMMENT satisfied.
 */
function maskComments(src) {
  return src
    .split('\n')
    .map((line) => (/^\s*(\/\/|\*|\/\*)/.test(line) ? ' '.repeat(line.length) : line))
    .join('\n');
}

describe('qa-sweep/config.py — the safety envelope', () => {
  test('self-test passes, and runs at least its committed floor of fixtures', () => {
    const r = run(CONFIG, ['--self-test']);
    assertSelfTestFloor(r.stdout, 'config', SELF_TEST_FLOORS.config);
    expect(r.stdout).not.toMatch(/FAIL/);
    expect(r.exitCode).toBe(0);
  });

  test('no allowlisted target resolves to the production project ref', () => {
    // The single invariant that makes every other control meaningful.
    const env = envelope();
    const prod = env.refs.prod;
    for (const [host, meta] of Object.entries(env.target_allowlist)) {
      expect(`${host} -> ${meta.ref}`).not.toBe(`${host} -> ${prod}`);
      expect(env.refs.allowed).toContain(meta.ref);
    }
  });

  test('every production host is enumerated as refused', () => {
    const env = envelope();
    // Beta is the one that gets argued about: it is production data behind an
    // in-app gate, not a test environment.
    for (const host of [
      'checklyra.com',
      'beta.checklyra.com',
      'admin.checklyra.com',
      'mcp.checklyra.com',
    ]) {
      expect(Object.keys(env.refused_hosts)).toContain(host);
      expect(env.refused_hosts[host].trim().length).toBeGreaterThan(0);
    }
  });

  test('the denylist is non-empty and every entry is keyed file::name with a reason', () => {
    const env = envelope();
    const entries = Object.entries(env.destructive_denylist);
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, reason] of entries) {
      expect(key).toMatch(/^src\/.+::[A-Za-z_$][\w$]*$/);
      // A denylist nobody can read is a denylist nobody maintains.
      expect(reason.trim().length).toBeGreaterThan(20);
    }
  });

  test('the actions the survey identified as destructive are all denylisted', () => {
    const env = envelope();
    const names = Object.keys(env.destructive_denylist).map((k) => k.split('::')[1]);
    for (const required of [
      'deleteAccount',
      'bulkUserAction',
      'setGlobalFeature',
      'signOut',
      'declineAge',
      'revokeApiKey',
      'updateEmail',
      'publishProfile',
      'submitRsvp',
      'cancelGathering',
      'sendInvites',
      'resendInvite',
      'cancelInvite',
      'addToHostCalendar',
      'startAgeVerification',
      'submitContact',
    ]) {
      expect(names).toContain(required);
    }
  });

  test('every denylisted action actually exists at the file it names', () => {
    // A denylist entry pointing at a moved or renamed function protects
    // nothing while still reading as protection.
    const env = envelope();
    for (const key of Object.keys(env.destructive_denylist)) {
      const [rel, name] = key.split('::');
      const abs = path.join(ROOT, rel);
      expect(fs.existsSync(abs)).toBe(true);
      const src = fs.readFileSync(abs, 'utf-8');
      expect(`${key} declared`).toBe(declaresAction(src, name) ? `${key} declared` : `${key} NOT-FOUND`);
    }
  });

  test('a bogus denylist entry would be caught — the existence check can fail', () => {
    // The paired negative control for the test above. Without it, a
    // `declaresAction` that returned true unconditionally would satisfy it.
    const key = Object.keys(envelope().destructive_denylist).find((k) =>
      k.endsWith('::deleteAccount'),
    );
    expect(key).toBeDefined();
    const src = fs.readFileSync(path.join(ROOT, key.split('::')[0]), 'utf-8');
    expect(declaresAction(src, 'deleteAccount')).toBe(true);
    expect(declaresAction(src, 'thisFunctionDoesNotExist')).toBe(false);
  });

  test('every function that calls auth.signOut() is denylisted, whatever it is called', () => {
    // BLOCKER 3. `signOut` was denylisted for terminating the session, which
    // made the hazard LOOK covered — but the denylist keys on `file::function`,
    // so the protection reached exactly one namesake.
    // `oauth/authorize/actions.ts::switchAccountAndContinue` calls
    // `sb.auth.signOut()` and then redirects to /login, is reached by clicking
    // an ordinary "Switch account" button, and was fully exercisable.
    //
    // So this derives the set from SOURCE rather than from the list: every
    // call site, mapped to its enclosing function, must be denylisted. A new
    // one added anywhere in src/ fails this test until it is listed.
    const denylist = new Set(Object.keys(envelope().destructive_denylist));
    const found = [];
    (function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules') walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        const src = maskComments(fs.readFileSync(full, 'utf-8'));
        const rel = path.relative(ROOT, full).split(path.sep).join('/');
        // Both declaration forms, or a session-ender declared as an arrow after
        // a denylisted `function` would be misattributed to that function and
        // silently inherit its protection.
        const decls = [
          ...src.matchAll(
            /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g,
          ),
          ...src.matchAll(
            /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?\(/g,
          ),
        ].sort((a, b) => a.index - b.index);
        for (const call of src.matchAll(/auth\s*\.\s*signOut\s*\(/g)) {
          const owner = decls.filter((d) => d.index < call.index).pop();
          found.push(`${rel}::${owner ? owner[1] : '<module-scope>'}`);
        }
      }
    })(path.join(ROOT, 'src'));

    // The scan must actually find call sites, or this passes by vacuous truth —
    // the exact failure mode the whole qa-sweep exists to avoid.
    expect(found.length).toBeGreaterThanOrEqual(5);
    // KAN-415 moved this to the app root to clear the last cross-segment edge.
    // Via SRC, not a literal, for the same reason as the line below: the key is
    // path-anchored, so a raw path here would have to be hand-edited on every
    // move and a missed edit reads as a passing test. `toContain` is safe
    // against gotcha #31 — a dropped key yields 'undefined::signOut', which is
    // absent from `found`, so the test FAILS rather than passing vacuously.
    expect(found).toContain(`${SRC.sessionActions}::signOut`);
    // KAN-415 D7 part 3 moved this body into a module. TWO-WAY ratchet: it
    // fails if the scan stops finding the call site at all, and it failed at
    // the old path the moment the file moved.
    expect(found).toContain(`${SRC.consentFlow}::switchAccountAndContinue`);

    // A denylist key must name an INVENTORIED action, and inventory.py only
    // inventories `'use server'` functions — so a call site inside a plain
    // module can never be a key, and requiring one would have forced a dead
    // entry that qa-sweep-inventory.test.js correctly rejects. What must hold
    // instead is that the module is only REACHABLE through a denylisted action.
    const appSites = [...new Set(found)].filter((k) => !k.startsWith(MODULES_ROOT));
    expect(appSites.filter((k) => !denylist.has(k))).toEqual([]);

    const denylistedFiles = [...denylist].map((k) => k.split('::')[0]);
    for (const site of [...new Set(found)].filter((k) => k.startsWith(MODULES_ROOT))) {
      const modulePath = '@/' + site.split('::')[0].replace(/^src\//, '').replace(/\.tsx?$/, '');
      const importers = denylistedFiles.filter((f) =>
        maskComments(fs.readFileSync(path.join(ROOT, f), 'utf-8')).includes(modulePath),
      );
      // `${site}` in the message so a failure names the unreachable module
      // rather than just reporting an empty array.
      expect(`${site} <- ${importers.length} denylisted importer(s)`).not.toBe(
        `${site} <- 0 denylisted importer(s)`,
      );
    }
  });

  test('both compensating-control env vars are required to be unset', () => {
    const env = envelope();
    expect(Object.keys(env.required_unset_env).sort()).toEqual([
      'GOOGLE_PLACES_API_KEY',
      'RESEND_API_KEY',
    ]);
  });

  test('/admin is modelled as inventory-only rather than omitted', () => {
    const env = envelope();
    expect(Object.keys(env.inventory_only_prefixes)).toContain('/admin');
  });

  test('the hostile-input budget is bounded', () => {
    const env = envelope();
    expect(env.hostile_input_budget.max_payloads_per_run).toBeGreaterThan(0);
    expect(env.hostile_input_budget.max_payloads_per_field).toBeGreaterThan(0);
    expect(env.hostile_input_budget.seeded_users_only).toBe(true);
  });

  test('the prod ref mirrors the E2E harness constant', () => {
    // preflight mirrors assertNotProd; if the harness rotates its project ref
    // and this copy does not, the mirror is silently broken.
    const harness = fs.readFileSync(
      path.join(ROOT, 'tests/e2e/support/supabase-admin.ts'),
      'utf-8',
    );
    const env = envelope();
    expect(harness).toContain(env.refs.prod);
    expect(harness).toContain(env.refs.dev);
    expect(harness).toContain(env.refs.staging);
  });
});

describe('qa-sweep/preflight.py — fails closed', () => {
  test('self-test passes, and runs at least its committed floor of fixtures', () => {
    const r = preflight(['--self-test']);
    assertSelfTestFloor(r.stdout, 'preflight', SELF_TEST_FLOORS.preflight);
    expect(r.stdout).not.toMatch(/FAIL/);
    expect(r.exitCode).toBe(0);
  });

  test('an allowlisted dev target with a clean environment passes', () => {
    // The positive control. Without it, a preflight that refused EVERYTHING
    // would satisfy every other test in this file.
    const r = preflight(['--target', 'e2e-dev.checklyra.com']);
    expect(r.stdout).toMatch(/PREFLIGHT PASSED/);
    expect(r.exitCode).toBe(0);
  });

  test.each([
    ['checklyra.com'],
    ['www.checklyra.com'],
    ['beta.checklyra.com'],
    ['admin.checklyra.com'],
    ['mcp.checklyra.com'],
  ])('refuses the production host %s', (host) => {
    const r = preflight(['--target', host]);
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toMatch(/PREFLIGHT FAILED CLOSED/);
    expect(r.stdout).not.toMatch(/PREFLIGHT PASSED/);
  });

  test('refusing beta explains that beta is production, not a test environment', () => {
    const r = preflight(['--target', 'beta.checklyra.com']);
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toMatch(/PRODUCTION data/i);
  });

  test('refuses a production Supabase ref even from an allowlisted host', () => {
    // Mirrors assertNotProd: the host being fine does not make the project fine.
    const prod = envelope().refs.prod;
    const r = preflight([
      '--target',
      'e2e-dev.checklyra.com',
      '--supabase-url',
      `https://${prod}.supabase.co`,
    ]);
    expect(r.exitCode).toBe(2);
    expect(r.stdout).not.toMatch(/PREFLIGHT PASSED/);
  });

  test('refuses an unrecognised Supabase ref rather than assuming it is safe', () => {
    const r = preflight([
      '--target',
      'e2e-dev.checklyra.com',
      '--supabase-url',
      'https://someunknownproject.supabase.co',
    ]);
    expect(r.exitCode).toBe(2);
  });

  test('refuses when RESEND_API_KEY is set', () => {
    // With this set, the contact form and beta-queue mails reach real inboxes
    // — neither has a recipient allowlist.
    const r = preflight(['--target', 'e2e-dev.checklyra.com'], {
      RESEND_API_KEY: 're_live_not_a_real_key',
    });
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toMatch(/RESEND_API_KEY/);
    expect(r.stdout).not.toMatch(/PREFLIGHT PASSED/);
  });

  test('refuses when GOOGLE_PLACES_API_KEY is set', () => {
    const r = preflight(['--target', 'e2e-dev.checklyra.com'], {
      GOOGLE_PLACES_API_KEY: 'AIza-not-a-real-key',
    });
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toMatch(/GOOGLE_PLACES_API_KEY/);
  });

  test('an empty API key counts as unset', () => {
    const r = preflight(['--target', 'e2e-dev.checklyra.com'], { RESEND_API_KEY: '' });
    expect(r.exitCode).toBe(0);
  });

  test('refuses when no target is supplied — there is no default', () => {
    const r = preflight([]);
    expect(r.exitCode).toBe(2);
    expect(r.stdout).not.toMatch(/PREFLIGHT PASSED/);
  });

  test('refuses an unknown host rather than defaulting to something safe-looking', () => {
    const r = preflight(['--target', 'staging.example.com']);
    expect(r.exitCode).toBe(2);
  });

  test('the ALLOWLIST check itself rejects an unknown host', () => {
    // Pinning the layer, not just the exit code. Mutation testing found this
    // gap: forcing the allowlist check to pass still produced exit 2, because
    // the Supabase-ref check independently failed. Defence in depth is good,
    // but a test that cannot tell which layer fired cannot detect one of them
    // silently becoming permissive.
    const r = preflight(['--target', 'staging.example.com']);
    const line = r.stdout
      .split('\n')
      .find((l) => l.includes('target is in the allowlist'));
    expect(line).toBeDefined();
    expect(line).toMatch(/FAIL/);
    expect(r.stdout).toMatch(/is not in the allowlist/);
  });

  test('the ALLOWLIST check passes for a genuinely allowlisted host', () => {
    // The paired positive control: the assertion above must be able to pass.
    const r = preflight(['--target', 'e2e-dev.checklyra.com']);
    const line = r.stdout
      .split('\n')
      .find((l) => l.includes('target is in the allowlist'));
    expect(line).toBeDefined();
    expect(line).toMatch(/PASS/);
  });

  test('an undetermined condition is reported as UNDETERMINED and still fails', () => {
    // Unknown must never be rendered as a pass.
    const r = preflight(['--target', 'staging.example.com']);
    expect(r.stdout).toMatch(/UNDETERMINED/);
    expect(r.exitCode).toBe(2);
  });

  test('CI without the Cloudflare bypass fails; with it, passes', () => {
    const without = preflight(['--target', 'e2e-dev.checklyra.com', '--ci']);
    expect(without.exitCode).toBe(2);
    expect(without.stdout).toMatch(/SEC-125/);

    const withBypass = preflight(['--target', 'e2e-dev.checklyra.com', '--ci'], {
      E2E_CF_BYPASS_HEADER: 'x-bypass',
      E2E_CF_BYPASS_SECRET: 'secret',
    });
    expect(withBypass.exitCode).toBe(0);
  });

  test('CI=true in the environment arms the same rule as --ci', () => {
    const r = preflight(['--target', 'e2e-dev.checklyra.com'], { CI: 'true' });
    expect(r.exitCode).toBe(2);
  });

  test('a local run without the bypass passes but surfaces the state', () => {
    const r = preflight(['--target', 'e2e-dev.checklyra.com']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/SEC-125/);
  });

  test('fails closed when the safety envelope cannot be imported', () => {
    // A denylist that will not load is indistinguishable from an empty one,
    // and an empty denylist permits everything by vacuous truth.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-preflight-'));
    try {
      const sandboxQa = path.join(dir, 'qa-sweep');
      fs.mkdirSync(sandboxQa);
      fs.copyFileSync(PREFLIGHT, path.join(sandboxQa, 'preflight.py'));
      fs.writeFileSync(path.join(sandboxQa, 'config.py'), 'this is not valid python(((\n');
      const r = run(path.join(sandboxQa, 'preflight.py'), [
        '--target',
        'e2e-dev.checklyra.com',
      ]);
      expect(r.exitCode).toBe(2);
      expect(r.stdout).not.toMatch(/PREFLIGHT PASSED/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('never exits 1 — there is no advisory tier', () => {
    // A soft-failure tier is how a preflight becomes decoration.
    const cases = [
      [[], {}],
      [['--target', 'checklyra.com'], {}],
      [['--target', 'e2e-dev.checklyra.com'], {}],
      [['--target', 'e2e-dev.checklyra.com'], { RESEND_API_KEY: 'x' }],
      [['--target', 'nope.example.com'], {}],
    ];
    for (const [args, env] of cases) {
      expect([0, 2]).toContain(preflight(args, env).exitCode);
    }
  });
});

/**
 * The Supabase-ref guard is four independent layers, and until 2026-08-04 NONE
 * of them was pinned: each could be deleted on its own with all 33 preflight
 * tests green, because the next layer down produced exit 2 anyway and every
 * assertion was on the exit code. With the first neutered, the report printed
 *
 *     [PASS] Supabase project ref is not production
 *
 * for the PRODUCTION ref and still exited 2. Remove all three refusal layers
 * and `--target e2e-dev.checklyra.com --supabase-url https://<prod>.supabase.co`
 * printed PREFLIGHT PASSED and exited 0.
 *
 * So every layer below is pinned by ITS OWN output line, each with a paired
 * positive control — without the control, a guard that refused EVERYTHING would
 * satisfy the refusal half and nobody would notice the tool had stopped working.
 * This is the shape the existing host-allowlist pair already used.
 */
describe('qa-sweep/preflight.py — each Supabase-ref layer is pinned on its own line', () => {
  const DETERMINABLE = 'Supabase project ref is determinable';
  const NOT_PROD = 'Supabase project ref is not production';
  const ALLOWED = 'Supabase project ref is positively allowed';
  const AGREES = 'target host and Supabase URL agree';

  const devUrl = () => `https://${envelope().refs.dev}.supabase.co`;
  const stagingUrl = () => `https://${envelope().refs.staging}.supabase.co`;
  const prodUrl = () => `https://${envelope().refs.prod}.supabase.co`;

  test('LAYER 1 — an unparseable Supabase URL is refused, not waved through', () => {
    const r = preflight(['--target', 'e2e-dev.checklyra.com', '--supabase-url', 'https://']);
    expect(statusOf(r.stdout, DETERMINABLE)).toBe('FAIL');
    expect(r.stdout).toMatch(/could not parse a project ref/);
    expect(r.stdout).not.toMatch(/PREFLIGHT PASSED/);
    expect(r.exitCode).toBe(2);
  });

  test('LAYER 1 — a ref that cannot be established at all is UNDETERMINED', () => {
    // No --supabase-url and an un-allowlisted host: the ref is unknown, and
    // unknown must never render as a pass.
    const r = preflight(['--target', 'staging.example.com']);
    expect(statusOf(r.stdout, DETERMINABLE)).toBe('UNDETERMINED');
    expect(r.exitCode).toBe(2);
  });

  test('LAYER 1 positive control — a real URL determines the ref', () => {
    const r = preflight(['--target', 'e2e-dev.checklyra.com', '--supabase-url', devUrl()]);
    expect(statusOf(r.stdout, DETERMINABLE)).toBe('PASS');
    expect(r.exitCode).toBe(0);
  });

  test('LAYER 2 — the production ref FAILS the not-production check itself', () => {
    const r = preflight(['--target', 'e2e-dev.checklyra.com', '--supabase-url', prodUrl()]);
    expect(statusOf(r.stdout, NOT_PROD)).toBe('FAIL');
    expect(r.stdout).toMatch(/refusing to run against project ref/);
    // Layer 1 passed, so this is genuinely layer 2 firing and not a knock-on.
    expect(statusOf(r.stdout, DETERMINABLE)).toBe('PASS');
    expect(r.exitCode).toBe(2);
  });

  test('LAYER 2 positive control — the dev ref PASSES that same check', () => {
    const r = preflight(['--target', 'e2e-dev.checklyra.com', '--supabase-url', devUrl()]);
    expect(statusOf(r.stdout, NOT_PROD)).toBe('PASS');
  });

  test('LAYER 3 — an unrecognised ref FAILS the positive allowlist itself', () => {
    const r = preflight([
      '--target',
      'e2e-dev.checklyra.com',
      '--supabase-url',
      'https://someunknownproject.supabase.co',
    ]);
    expect(statusOf(r.stdout, ALLOWED)).toBe('FAIL');
    expect(r.stdout).toMatch(/unrecognised project ref/);
    // It got past layers 1 and 2 — an unknown project is not the prod project,
    // and refusing it is the ALLOWLIST doing the work, not the prod check.
    expect(statusOf(r.stdout, DETERMINABLE)).toBe('PASS');
    expect(statusOf(r.stdout, NOT_PROD)).toBe('PASS');
    expect(r.exitCode).toBe(2);
  });

  test('LAYER 3 positive control — an allowed ref PASSES the allowlist check', () => {
    const r = preflight(['--target', 'e2e-dev.checklyra.com', '--supabase-url', devUrl()]);
    expect(statusOf(r.stdout, ALLOWED)).toBe('PASS');
  });

  test('LAYER 4 — a host/URL disagreement FAILS even though both are allowed', () => {
    // e2e-dev maps to the dev project; the URL names staging. Neither is prod
    // and both are positively allowed, so layers 2 and 3 pass — only the
    // agreement check can catch this, which is what makes it its own layer.
    const r = preflight(['--target', 'e2e-dev.checklyra.com', '--supabase-url', stagingUrl()]);
    expect(statusOf(r.stdout, AGREES)).toBe('FAIL');
    expect(statusOf(r.stdout, NOT_PROD)).toBe('PASS');
    expect(statusOf(r.stdout, ALLOWED)).toBe('PASS');
    expect(r.stdout).toMatch(/in the allowlist but --supabase-url resolves/);
    expect(r.exitCode).toBe(2);
  });

  test('LAYER 4 positive control — the matching host and URL agree', () => {
    const r = preflight(['--target', 'e2e-stage.checklyra.com', '--supabase-url', stagingUrl()]);
    expect(statusOf(r.stdout, AGREES)).toBe('PASS');
    expect(r.exitCode).toBe(0);
  });

  test('the reviewer command that once printed PREFLIGHT PASSED does not', () => {
    // Verbatim: this is what an envelope with its three refusal layers removed
    // accepted. Kept as its own case so the regression has a name.
    const r = preflight(['--target', 'e2e-dev.checklyra.com', '--supabase-url', prodUrl()]);
    expect(r.stdout).not.toMatch(/PREFLIGHT PASSED/);
    expect(r.stdout).toMatch(/PREFLIGHT FAILED CLOSED/);
    expect(r.exitCode).toBe(2);
  });
});

describe('qa-sweep/preflight.py — the 0-or-2 exit-code contract holds on every path', () => {
  /** A sandbox whose config.py is the real envelope plus an override suffix. */
  function sandbox(suffix) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-preflight-contract-'));
    const qa = path.join(dir, 'qa-sweep');
    fs.mkdirSync(qa);
    fs.copyFileSync(PREFLIGHT, path.join(qa, 'preflight.py'));
    fs.writeFileSync(
      path.join(qa, 'config.py'),
      `${fs.readFileSync(CONFIG, 'utf-8')}\n${suffix}`,
    );
    return { dir, script: path.join(qa, 'preflight.py') };
  }

  /** The attribute list the subject itself declares, so this cannot drift. */
  function requiredAttrs() {
    const m = /REQUIRED_ENVELOPE_ATTRS\s*=\s*\(([^)]*)\)/.exec(fs.readFileSync(PREFLIGHT, 'utf-8'));
    expect(m).not.toBeNull();
    return (m[1].match(/"([^"]+)"/g) || []).map((s) => s.slice(1, -1));
  }

  test('a missing envelope attribute exits 2, for EVERY attribute the preflight reads', () => {
    // Was exit 1: an uncaught AttributeError. Only DESTRUCTIVE_DENYLIST was
    // guarded, so it was the one attribute whose absence failed closed.
    // Enumerated rather than sampled — one attribute proves one attribute.
    const attrs = requiredAttrs();
    expect(attrs.length).toBeGreaterThanOrEqual(12);
    const wrong = [];
    for (const attr of attrs) {
      const { dir, script } = sandbox(`del ${attr}\n`);
      try {
        const r = run(script, ['--target', 'e2e-dev.checklyra.com']);
        if (r.exitCode !== 2 || /PREFLIGHT PASSED/.test(r.stdout)) {
          wrong.push(`${attr}=>${r.exitCode}`);
        }
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
    expect(wrong).toEqual([]);
  });

  test('the missing attribute is named in the failure, not swallowed', () => {
    const { dir, script } = sandbox('del REFUSED_HOSTS\n');
    try {
      const r = run(script, ['--target', 'e2e-dev.checklyra.com']);
      expect(r.exitCode).toBe(2);
      expect(r.stdout).toMatch(/REFUSED_HOSTS/);
      expect(r.stdout).toMatch(/PREFLIGHT FAILED CLOSED/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('sandbox positive control — an unmodified envelope still passes there', () => {
    // Without this, the test above would pass if the sandbox were simply broken.
    const { dir, script } = sandbox('# no override\n');
    try {
      const r = run(script, ['--target', 'e2e-dev.checklyra.com']);
      expect(r.stdout).toMatch(/PREFLIGHT PASSED/);
      expect(r.exitCode).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--self-test exits 2 (never 1) when the envelope has been made permissive', () => {
    // Two things at once: the self-test fixtures genuinely detect a permissive
    // envelope, and a failing self-test honours the 0-or-2 contract. It
    // returned 1 — the code a caller retries rather than reads.
    const { dir, script } = sandbox(
      'REFUSED_REFS = {}\nALLOWED_REFS = (DEV_REF, STAGING_REF, PROD_REF)\n',
    );
    try {
      const r = run(script, ['--self-test']);
      expect(r.exitCode).toBe(2);
      // And it is the LAYER fixture that catches it. The whole-run fixture
      // ("prod Supabase ref is refused even from an allowlisted host") stays
      // green against this mutation, because the host/URL agreement layer still
      // fails the run — which is precisely why per-layer fixtures were needed.
      expect(r.stdout).toMatch(/FAIL\s+LAYER 2: the prod ref FAILS the not-production check/);
      expect(r.stdout).toMatch(/preflight self-test: \d+\/\d+ passed/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
