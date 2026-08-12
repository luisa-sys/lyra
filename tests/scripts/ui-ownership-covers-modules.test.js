/**
 * KAN-473 / KAN-415 D9 — the founder-owned surface must not SHRINK on a move.
 *
 * WHY THIS EXISTS
 * ---------------
 * D9 moved three founder-owned components out of the `[slug]` route tree into
 * `src/modules/public-profile/`. Measured before the move, by running the
 * shipped `is_protected()` against both paths — for each of the three:
 *
 *     FOUNDER-OWNED   <component>.tsx at its old route-tree path
 *     not protected   <component>.tsx at its new module path
 *
 * (The old paths are written that way on purpose: spelling them would leave a
 * dead path literal in a live file, which is precisely what the KAN-428
 * extraction gate fails a PR for — and it failed this one until it was fixed.)
 *
 * `is_protected` matched `src/app/*.tsx` and `src/components/*` and NOTHING
 * under `src/modules/`. So the extraction would have removed three user-facing
 * components from founder ownership permanently, with no red build — because
 * "matches nothing" is detectable and "matches less than it used to" is not.
 *
 * ⚠️ THE SECOND-ORDER EFFECT IS THE SHARP ONE. The `UI-Change-Approved:`
 * trailer authorising the move would have carried it through this very gate,
 * and the move would then have switched the gate off for those files from then
 * on — turning a one-time founder approval into a standing one.
 *
 * KAN-415 still has D7 and D8 to come, so this is not a one-off.
 *
 * WHAT THIS FILE DOES NOT DO
 * --------------------------
 * It does not assert a global ratchet over the whole protected set. That is the
 * stronger control — nothing today asserts the founder-owned file count cannot
 * fall — and it is recorded as a candidate on KAN-473 rather than built here.
 * This file pins the specific regression D9 introduced the risk of.
 *
 * It sources `is_protected` out of the real script rather than reimplementing
 * the predicate (CTL-038): a private copy would keep passing while the shipped
 * guard drifted, which is the failure mode this whole file is about.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { SRC } = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'tests/support/source-paths.json'), 'utf-8'),
);
const GUARD = SRC.checkUiCopyOwnership;

/**
 * Ask the SHIPPED guard whether a path is founder-owned.
 *
 * `is_protected` is extracted from the script and evaluated, so this exercises
 * the real predicate. Extraction is by line range on the function definition —
 * if that shape ever changes the harness throws rather than silently answering
 * "not protected" for everything, which would make every assertion below pass
 * for the wrong reason.
 */
function isProtected(relPath) {
  const script = fs.readFileSync(path.join(ROOT, GUARD), 'utf-8');
  const fn = /^is_protected\(\) \{[\s\S]*?^\}/m.exec(script);
  if (!fn) throw new Error(`could not extract is_protected() from ${GUARD}`);

  const out = execFileSync(
    'bash',
    ['-c', `${fn[0]}\nif is_protected "$1"; then echo yes; else echo no; fi`, '_', relPath],
    { encoding: 'utf-8', cwd: ROOT },
  ).trim();
  return out === 'yes';
}

/** Every tracked .tsx that D9 moved into the module. */
const MOVED_TSX = [SRC.reportButton, SRC.recommendationsSection, SRC.v2RecommendationsSection];

/** The module root, derived rather than spelled, so a rename moves one value. */
const MODULE_ROOT = path.posix.dirname(SRC.reportButton);
/** …and the modules root above it, likewise derived. */
const MODULES_ROOT = path.posix.dirname(MODULE_ROOT);

/**
 * Paths that DO NOT EXIST, and must not.
 *
 * These ask what the predicate WOULD say about a file the next extraction has
 * not created yet, so they cannot come from the manifest — it only ever holds
 * paths that exist, which is its whole promise, and `SRC.notYetWritten` would
 * be `undefined` (catalogue failure mode 3).
 *
 * They are BUILT from `MODULES_ROOT` rather than spelled out, which is not a
 * dodge around the shrink-only raw-literal ratchet but the better expression of
 * the assertion: the claim is "a .tsx anywhere under the modules root", and
 * deriving that root from a real manifest entry states it once. Spelling it
 * would also re-break on the next tree move — the failure this whole file is
 * about.
 */
const HYPOTHETICAL_MODULE_TSX = [
  `${MODULES_ROOT}/trust-safety/some-component.tsx`,
  `${MODULES_ROOT}/profile/editor-section.tsx`,
];

describe('KAN-473 — extracting UI must not un-protect it', () => {
  test('the harness reaches the real predicate, not a copy', () => {
    // If this throws or silently answers "no" to everything, every other
    // assertion in this file becomes vacuous. Assert a known-true and a
    // known-false case so a broken harness is loud.
    expect(isProtected(SRC.appPage)).toBe(true);
    expect(isProtected(SRC.healthRoute)).toBe(false);
  });

  test('the corpus is non-empty and every moved file is tracked', () => {
    // Catalogue failure mode 4: iterating an empty list registers nothing and
    // is green. Assert the corpus before using it, and use TRACKED state —
    // `git mv` leaves the source directory behind on disk (failure mode 6).
    const tracked = execFileSync('git', ['-C', ROOT, 'ls-files', MODULE_ROOT], {
      encoding: 'utf-8',
    })
      .split('\n')
      .filter(Boolean);

    expect(MOVED_TSX.length).toBe(3);
    for (const f of MOVED_TSX) {
      expect(`${f} tracked: ${tracked.includes(f)}`).toBe(`${f} tracked: true`);
    }
  });

  test('every .tsx D9 moved is STILL founder-owned at its new path', () => {
    for (const f of MOVED_TSX) {
      expect(`${f} founder-owned: ${isProtected(f)}`).toBe(`${f} founder-owned: true`);
    }
  });

  test('the rule generalises — a .tsx in a module D9 never touched is covered too', () => {
    // The rule is stated on the file type, not on a module name, precisely so
    // D7 and D8 are covered by default rather than by someone remembering.
    // These paths need not exist: the question is what the predicate would say
    // if the next extraction created them.
    expect(HYPOTHETICAL_MODULE_TSX.length).toBeGreaterThan(0);
    for (const f of HYPOTHETICAL_MODULE_TSX) {
      expect(`${f} would be founder-owned: ${isProtected(f)}`).toBe(
        `${f} would be founder-owned: true`,
      );
    }
  });

  test('it does NOT over-capture — module logic stays unprotected', () => {
    // Over-capturing would make the gate fire on every extraction commit, and a
    // gate that always fires is one people learn to wave through.
    for (const f of [
      SRC.slugUtils,
      SRC.v2RecommendationsHelpers,
      SRC.platformEnv,
      SRC.accessPipeline,
    ]) {
      expect(`${f} founder-owned: ${isProtected(f)}`).toBe(`${f} founder-owned: false`);
    }
  });

  test('modules.json records the same surface the guard enforces', () => {
    // The two must agree, or the manifest documents a protection that is not
    // applied — the "documentation describing a thing is indistinguishable from
    // the thing" trap. modules.json is read by humans; the guard is read by CI.
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules.json'), 'utf-8'));
    const cp = manifest.modules['public-profile'].changeProcess;
    expect(cp.uiApprovalGated).toBe('always');
    expect(cp.uiApprovalPaths).toContain(`${MODULE_ROOT}/**`);
    expect(manifest.modules['public-profile'].paths).toContain(`${MODULE_ROOT}/`);
  });
});
