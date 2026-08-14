/**
 * KAN-415 — pin two facts about `.dependency-cruiser.cjs` that its own comments
 * got wrong, and that only mutation could settle.
 *
 * 1. `DEPCRUISE_SEVERITY=warn` DOES NOT SWITCH THE GATE OFF.
 *
 *    `pr-checks.yml` invokes the gate as `DEPCRUISE_SEVERITY=warn`, and both it
 *    and `check-dependency-rules.sh` carried a comment reading "the gate ships
 *    at severity `warn` — violations are printed and annotated, the build stays
 *    green". That was true of the single global dial KAN-414 F3 replaced on
 *    2026-07-29, and false for ~2 weeks afterwards: severity is now assigned per
 *    rule via `severityFor(ruleAtZero) => (FORCE_ERROR || ruleAtZero ? 'error'
 *    : 'warn')`, and `FORCE_ERROR` is a ONE-WAY override. A rule measured at
 *    zero violations passes `ruleAtZero = true` and resolves to `error`
 *    whatever the env var says.
 *
 *    So `no-module-to-app` and `no-circular` were blocking while the workflow
 *    described them as advisory. A stale comment claiming a live control is off
 *    is its own hazard: it is how a control gets ignored, distrusted, or removed
 *    as dead weight. These tests make the real behaviour the enforced fact, so
 *    the comment cannot drift away from it again.
 *
 * 2. A NEXT.JS PRIVATE FOLDER IS NOT A ROUTE SEGMENT.
 *
 *    `APP_SEGMENTS` read every directory under `src/app` off disk, so
 *    `src/app/_marketing/` — a colocation directory that Next.js opts out of
 *    routing entirely — became a "segment" and produced a cross-segment
 *    violation that was never a cross-segment edge.
 *
 *    Fixing it needed BOTH ends. Removing `_marketing` from the segment list
 *    stopped rules being generated FOR it, and the violation count did not move:
 *    every other segment still flagged an import INTO it, because `to.path`
 *    matched `^src/app/[^/]+/`. Measured after the first attempt: still 2. Both
 *    the source list and the target pattern needed the same definition.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const CONFIG = path.join(ROOT, '.dependency-cruiser.cjs');
// Real paths come from the manifest, not literals: the F4 raw-literal ratchet
// is shrink-only, and routing through SRC means a future move updates one entry
// rather than these assertions.
const { SRC } = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../support/source-paths.json'), 'utf-8'),
);

/**
 * Load the REAL config under a given env value. Never a copy (CTL-038).
 *
 * ⚠️ `jest.resetModules()`, NOT `delete require.cache[...]`. Jest maintains its
 * OWN module registry, so deleting from Node's `require.cache` is a silent
 * no-op under jest and every call returns the module cached from the FIRST
 * load. The first draft of this file did exactly that: eight of nine tests
 * passed while all of them read one config object built under `warn`, and only
 * the one assertion that happened to expect the opposite value exposed it.
 *
 * A helper that appears to vary its input and does not is the sharpest form of
 * "passes for the wrong reason" — every test downstream of it is measuring the
 * same thing under different names.
 */
function loadConfig(severity) {
  const prev = process.env.DEPCRUISE_SEVERITY;
  if (severity === undefined) delete process.env.DEPCRUISE_SEVERITY;
  else process.env.DEPCRUISE_SEVERITY = severity;
  jest.resetModules();
  try {
    return require(CONFIG);
  } finally {
    if (prev === undefined) delete process.env.DEPCRUISE_SEVERITY;
    else process.env.DEPCRUISE_SEVERITY = prev;
    jest.resetModules();
  }
}

const severityOf = (cfg, name) => cfg.forbidden.find((r) => r.name === name)?.severity;

describe('depcruise severity — `warn` does not mean "switched off"', () => {
  test.each(['no-module-to-app', 'no-circular'])(
    '%s is `error` even under DEPCRUISE_SEVERITY=warn',
    (rule) => {
      // This is the exact invocation pr-checks.yml uses.
      const cfg = loadConfig('warn');
      expect(`${rule} under warn: ${severityOf(cfg, rule)}`).toBe(`${rule} under warn: error`);
    },
  );

  test('the dial still HAS a warn branch — the contrast case, no longer borrowed from unfinished work', () => {
    // This assertion used to read "no-cross-segment-app is warn", because an
    // unfinished rule was the only available proof that severityFor varies.
    // KAN-415 finished it (2026-08-14), so every rule now resolves to error and
    // that evidence is gone — at which point `severityFor = () => 'error'` would
    // pass every other test in this file, and the next rule landed at NOT_YET
    // would block on day one instead of reporting.
    //
    // So the mechanism is asserted directly instead of being inferred from which
    // rules happen to be incomplete. Same property, no longer dependent on the
    // codebase staying dirty to prove the gate is clean.
    jest.resetModules();
    const prev = process.env.DEPCRUISE_SEVERITY;
    delete process.env.DEPCRUISE_SEVERITY;
    try {
      const { severityFor, BLOCKING, NOT_YET } = require(
        path.join(ROOT, SRC.depcruiseSeverity),
      );
      expect(`NOT_YET -> ${severityFor(NOT_YET)}`).toBe('NOT_YET -> warn');
      expect(`BLOCKING -> ${severityFor(BLOCKING)}`).toBe('BLOCKING -> error');
      // ...and the override lifts warn to error, never the reverse.
      process.env.DEPCRUISE_SEVERITY = 'error';
      expect(`NOT_YET under override -> ${severityFor(NOT_YET)}`).toBe(
        'NOT_YET under override -> error',
      );
      process.env.DEPCRUISE_SEVERITY = 'warn';
      expect(`BLOCKING under warn -> ${severityFor(BLOCKING)}`).toBe(
        'BLOCKING under warn -> error',
      );
    } finally {
      if (prev === undefined) delete process.env.DEPCRUISE_SEVERITY;
      else process.env.DEPCRUISE_SEVERITY = prev;
      jest.resetModules();
    }
  });

  test('every cross-segment rule now blocks — the work that retired the contrast case', () => {
    // The other half: prove the rule actually flipped, so this file records the
    // new state rather than merely tolerating it.
    const cfg = loadConfig('warn');
    const cross = cfg.forbidden.filter((r) => r.name.startsWith('no-cross-segment-app/'));
    expect(cross.length).toBeGreaterThan(0);
    expect([...new Set(cross.map((r) => r.severity))]).toEqual(['error']);
  });

  test('DEPCRUISE_SEVERITY=error forces EVERY rule to error — the override is one-way', () => {
    const cfg = loadConfig('error');
    const nonError = cfg.forbidden.filter((r) => r.severity !== 'error').map((r) => r.name);
    expect(`non-error rules under DEPCRUISE_SEVERITY=error: ${JSON.stringify(nonError)}`).toBe(
      'non-error rules under DEPCRUISE_SEVERITY=error: []',
    );
  });

  test('with the variable unset, the blocking rules still block', () => {
    // The default must not be weaker than the value CI passes, or a local run
    // would be more permissive than CI and disagree about a real violation.
    const cfg = loadConfig(undefined);
    expect(severityOf(cfg, 'no-module-to-app')).toBe('error');
    expect(severityOf(cfg, 'no-circular')).toBe('error');
  });
});

describe('depcruise scope — a Next.js private folder is not a route segment', () => {
  test('no rule is generated FOR a private folder', () => {
    const cfg = loadConfig('warn');
    const segments = cfg.forbidden
      .filter((r) => r.name.startsWith('no-cross-segment-app/'))
      .map((r) => r.name.slice('no-cross-segment-app/'.length));
    // Assert the corpus is real before asserting anything about its contents
    // (catalogue failure mode 4 — a conclusion drawn from an empty list).
    expect(segments.length).toBeGreaterThan(10);
    expect(segments.filter((s) => s.startsWith('_'))).toEqual([]);
  });

  test('and none is generated pointing INTO one — the half the first fix missed', () => {
    // Removing `_marketing` from APP_SEGMENTS alone left the count unchanged at
    // 2, because every other segment's `to.path` still matched it. Without this
    // assertion a future edit could revert exactly that half and the suite would
    // stay green while the false positive returned.
    const cfg = loadConfig('warn');
    const cross = cfg.forbidden.filter((r) => r.name.startsWith('no-cross-segment-app/'));
    for (const rule of cross) {
      expect(`${rule.name} to.path: ${rule.to.path}`).toBe(
        `${rule.name} to.path: ^src/app/(?!_)[^/]+/`,
      );
    }
  });

  test('a private folder actually exists, or this fixes nothing', () => {
    // If src/app/_marketing/ were ever deleted, these tests would pass while
    // asserting nothing about the real tree. Pin the precondition.
    const appDir = path.join(ROOT, 'src', 'app');
    const privates = fs
      .readdirSync(appDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith('_'))
      .map((e) => e.name);
    expect(privates.length).toBeGreaterThan(0);
  });

  test('a REAL cross-segment edge is still caught — this is a correction, not a relaxation', () => {
    // The load-bearing test. Narrowing a rule's scope is how a gate gets
    // quietly disabled, so prove the rule still fires on the thing it exists
    // for: a genuine segment-to-segment import, which is not private-folder
    // shaped and must still match.
    const cfg = loadConfig('warn');
    const dashboard = cfg.forbidden.find((r) => r.name === 'no-cross-segment-app/dashboard');
    expect(dashboard).toBeDefined();
    const toRe = new RegExp(dashboard.to.path);
    const notRe = new RegExp(dashboard.to.pathNot);
    const realEdge = SRC.actions;
    expect(typeof realEdge).toBe('string'); // gotcha #31: a lost key makes this vacuous
    expect(`${realEdge} matches to.path: ${toRe.test(realEdge)}`).toBe(
      `${realEdge} matches to.path: true`,
    );
    expect(`${realEdge} excluded by pathNot: ${notRe.test(realEdge)}`).toBe(
      `${realEdge} excluded by pathNot: false`,
    );
    // ...and the private folder is not matched, which is the whole change.
    expect(typeof SRC.sections).toBe('string');
    expect(toRe.test(SRC.sections)).toBe(false);
  });
});
