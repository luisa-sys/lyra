/**
 * KAN-414 F4 — seeds for the source-path manifest.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `scripts/gen-test-paths.mjs` is SELF-FEEDING: it builds `SRC` by harvesting
 * repo-path literals out of `tests/**`. That is deliberate — a hand-maintained
 * list drifts from what the tests actually reference (the BUGS-74 lesson) — but
 * it has one sharp edge:
 *
 *   A path referenced ONLY as `SRC.foo` has no literal anywhere, so the next
 *   regeneration does not rediscover it and the key SILENTLY DISAPPEARS.
 *
 * `SRC.foo` then evaluates to `undefined`, and `undefined` is quietly useful in
 * all the wrong ways: `expect(x).not.toContain(undefined)` passes, and
 * `path.join(root, undefined)` throws an error that reads like a broken
 * harness. A test can therefore go from "asserting something" to "asserting
 * nothing" with no diff to the test itself.
 *
 * A key needs a literal SOMEWHERE. This file is that somewhere.
 *
 * WHY HERE AND NOT IN THE TEST
 * ----------------------------
 * The shrink-only raw-literal ratchet counts literals in `tests/**` but
 * deliberately EXCLUDES `tests/support/**` — in the generator's own words,
 * "the manifest is where the literals are supposed to live". Putting the seed
 * here is therefore aligned with the ratchet rather than a way around it: the
 * literal exists exactly once, in the layer designed to hold it, and a file
 * move updates this one line instead of N assertions.
 *
 * A MOVE BREAKS THE SELF-SUSTAINING LOOP — THIS IS THE TRAP
 * ---------------------------------------------------------
 * `tests/support/source-paths.ts` is itself a tracked `.ts` file under
 * `tests/`, so the generator reads its own previous output and rediscovers
 * every key it already holds. The manifest is therefore SELF-SUSTAINING in
 * steady state, which is why hand-editing a value works and persists — and why
 * it is easy to believe no seeding is ever needed.
 *
 * A FILE MOVE breaks that loop, because the generator keeps only literals that
 * still resolve on disk:
 *
 *   1. `git mv src/lib/features/x.ts src/modules/features/x.ts`
 *   2. the manifest still says `src/lib/features/x.ts`
 *   3. that path no longer exists -> the literal is discarded
 *   4. no test contains the NEW literal yet -> nothing replaces it
 *   5. the key is GONE, and `SRC.x` is now `undefined`
 *
 * The failure that produces is `TypeError: The "paths[2]" argument must be of
 * type string` from `resolve(__dirname, '../../', undefined)` — which reads
 * like a broken harness, not like a missing manifest entry. It cost real time
 * during KAN-415 D5/D6 before it was recognised.
 *
 * So: WHEN YOU MOVE A FILE THAT ANY TEST REACHES VIA `SRC`, either update the
 * value in the manifest in the same commit (the loop then re-sustains it), or
 * seed it here. Seeding is the durable option, because it survives a
 * regeneration performed from a stale checkout — which is exactly how the key
 * was lost the first time.
 *
 * `tests/unit/source-path-manifest-integrity.test.ts` now fails loudly on this
 * whole class, so it cannot recur silently.
 *
 * WHEN TO ADD A SEED
 * ------------------
 * Only when a test needs a path the manifest does not already carry. First
 * check whether a key exists — most paths are already covered because some
 * other test still hard-codes them. Add here only for the residue.
 *
 * Each entry names its reader, so an orphaned seed is visible as a seed nobody
 * consumes rather than as a mystery constant.
 */

/**
 * Paths that must have a `SRC` key but are not hard-coded by any counted test.
 *
 * Consumed by: tests/scripts/check-signup-surface-gate.test.js — which asserts
 * the KAN-413 signup-surface gate (CTL-013) actually fires on one real file
 * from each region of its manifest. Those assertions must survive KAN-415's
 * moves, which is the whole reason they route through `SRC` rather than naming
 * paths directly.
 */
export const SEEDED_PATHS = [
  // The 18+ self-declaration (KAN-407) — the age half of the signup contract.
  'src/modules/age/self-declaration.ts',
  // Where D4 moved the gating that decides where a new user lands.
  'src/modules/access/pipeline.ts',
  // The Supabase client the signup and confirm paths run through.
  'src/modules/platform/supabase-server.ts',
  // D5 moved this out of src/lib/features/. Read by SRC in
  // global-enforcement.test.ts and kan342-gift-visibility.test.ts, and by
  // literal in neither — so without this seed the key does not come back.
  // See "A MOVE BREAKS THE SELF-SUSTAINING LOOP" below.
  'src/modules/features/entitlements-service.ts',
  // D6 moved these out of src/lib/age/ and src/lib/auth/. Both are read via
  // SRC by tests that assert the KAN-408 global-switch wiring and the
  // post-login redirect contract; neither is hard-coded anywhere that counts.
  // The move dropped both keys and `tsc` caught it — the typed manifest turns
  // this class into a COMPILE error for .ts tests, which is the earliest and
  // loudest place it can surface. .js tests get no such warning, which is why
  // source-path-manifest-integrity.test.ts checks the whole estate at runtime.
  'src/modules/age/provider-gate.ts',
  'src/modules/auth/post-login-redirect.ts',
  // D7 part 3 moved the OAuth consent decisions out of the app tree. Read via
  // SRC by consent-account-banner.test.ts, whose whole point is that the
  // KAN-88 wiring survives; the literal lives here rather than in that file so
  // the next move updates one line instead of four assertions.
  'src/modules/oauth-as/consent-flow.ts',
  // KAN-415 moved `signOut` to the app root to clear the last
  // no-cross-segment-app edge. Read via SRC by qa-sweep-preflight.test.js,
  // which pins the derived denylist key — so the literal lives here and the
  // next move updates one line rather than an assertion. Unlike the module
  // moves above this one MUST stay under src/app/: the qa-sweep denylist key
  // has to name a `'use server'` action or inventory.py cannot see it.
  'src/app/session-actions.ts',
  // KAN-415 pulled the depcruise severity dial out of .dependency-cruiser.cjs
  // so it could be unit-tested directly once no unfinished rule was left to
  // infer it from. Two suites reach it by path; seeded so neither needs a raw
  // literal, which the F4 ratchet correctly refuses to let rise.
  'scripts/depcruise-severity.cjs',
  // CTL-026's own implementation. SEC-119 gave the meta-control its first
  // test; that suite reaches the checker by path and nothing else names it as
  // a literal, so without this seed the key would not come back on the next
  // regeneration and SRC.checkControlRegistry would go `undefined`.
  'scripts/check-control-registry.py',
  // D8 moved the profile domain core out of the editor's app tree. All three
  // keys were DROPPED by the regeneration — read only via SRC, hard-coded
  // nowhere that counts — which is the self-sustaining loop breaking exactly as
  // described above. Two of them (profileFields, sectionVisibility) went
  // `undefined` and were caught by source-path-manifest-integrity rather than
  // by anything in the suites that read them.
  'src/modules/profile/types.ts',
  'src/modules/profile/profile-fields.ts',
  'src/modules/profile/section-visibility.ts',
  'src/modules/profile/favourites.ts',
  // CTL-047's own implementation. check-docs-updated.test.js asserts that the
  // control registry's `implementation` field and pr-checks.yml both name this
  // exact path — the assertion IS the path, so a literal there would make a
  // rename look like a passing test against a script nobody runs.
  // CTL-048's implementation. check-live-schema-parity.test.js asserts the
  // registry's `implementation` field and the workflows both name this exact
  // path — the assertion IS the path, so a literal in the test would make a
  // rename look like a passing test against a script nobody runs.
  // CTL-056's implementation. check-release-tagged.test.js asserts the control
  // registry's `implementation` field and release-integrity.yml both name this
  // exact path — the assertion IS the path, so a literal in the test would make
  // a rename look like a passing test against a script nobody runs.
  'scripts/check-release-tagged.py',
  // CTL-056's workflow. Its tests read it via SRC to assert fetch-depth and the
  // workflow_run trigger, so once those literals are routed through the
  // manifest nothing hard-codes the path and the key would vanish on the next
  // regeneration — the self-sustaining loop breaking exactly as described above.
  '.github/workflows/release-integrity.yml',
  // ⚠️ NOT a key CTL-057 created — one it nearly DELETED. check-release-tagged
  // asserts its `workflow_run` trigger names the promote workflow that really
  // exists, and routing that assertion through SRC removed the last full-path
  // literal in the estate: the other three tests that mention this workflow use
  // the BARE filename ('promote-to-production.yml'), which does not resolve on
  // disk and so is never harvested. The key vanished and two suites went red.
  // Gotcha #31 reaching a key the change did not introduce.
  '.github/workflows/promote-to-production.yml',
  'scripts/check-live-schema-parity.py',
  'scripts/check-docs-updated.py',
  // SEC-133 gave CTL-048 a DAILY half, and these three are the residue: no
  // counted test hard-codes any of them, so all three exist only as `SRC.*`.
  // check-live-schema-parity.test.js asserts that the daily job invokes the
  // checker with --snapshot-only, and that gen-db-types.sh refuses to write
  // without a token. Both assertions are ABOUT the paths, so a literal in the
  // test would let a rename read as a pass against a job nobody runs — the
  // same reasoning as the two entries above.
  '.github/workflows/db-invariants.yml',
  'scripts/gen-db-types.sh',
  // CTL-028's implementation, seeded for the same reason as CTL-047's and
  // CTL-048's above: check-suspension-guard-coverage.test.js asserts the
  // registry's `implementation` field names this exact path, so the assertion
  // IS the path and a literal in the test would let a rename read as a pass
  // against a control nobody runs. SEC-104 step 3.
  'scripts/check-suspension-guard-coverage.py',
  // CTL-070's implementation (KAN-475). source-path-identity.test.js runs the
  // checker as a subprocess and asserts the registry's `implementation` field
  // and pr-checks.yml both name this exact path — the assertion IS the path, so
  // a literal in the test would let a rename read as a pass against a control
  // nobody runs. Seeded rather than hard-coded for the usual reason: the test
  // reaches it only as `SRC.checkSourcePathIdentity`, so the key would not come
  // back on the next regeneration.
  'scripts/check-source-path-identity.py',
  // The snapshot gen-db-types.sh must leave untouched when it fails closed.
  // `prod.ts` and `staging.ts` keys survive on other tests' literals; `dev.ts`
  // had none, so it is the one that would silently vanish.
  'src/types/database/dev.ts',
  // KAN-473 / KAN-415 D9 moved these five out of src/app/[slug]/. All are now
  // reached ONLY via SRC — ui-ownership-covers-modules.test.js routes every
  // real path through the manifest so the raw-literal ratchet stays honest,
  // and the two unit tests import the helpers by alias. That is the exact
  // shape described above: a move breaks the self-sustaining loop, and a key
  // read only as `SRC.foo` does not come back on the next regeneration.
  //
  // The three .tsx matter most: they are FOUNDER-OWNED, and the test that
  // proves they stayed founder-owned across the move reads them through these
  // keys. Lose a key and that assertion runs against `undefined` — which
  // `is_protected` would answer "not protected" for, inverting the test.
  'src/modules/public-profile/report-button.tsx',
  'src/modules/public-profile/recommendations-section.tsx',
  'src/modules/public-profile/v2-recommendations-section.tsx',
  'src/modules/public-profile/slug-utils.ts',
  'src/modules/public-profile/v2-recommendations-helpers.ts',
  // CTL-049 / SEC-137. Both are reached ONLY through `SRC` — the test routes
  // every path through the manifest so the F4 raw-literal ratchet (shrink-only)
  // is not raised by a new file, which would have been the easy wrong move.
  //
  // Seeding matters more than usual for the checker: the registry's
  // `implementation` field names it, and `tests/scripts/` asserts that the
  // daily workflow invokes THAT path. Lose the key and the assertion compares
  // against `undefined`, which no workflow contains — so the test would fail
  // loudly rather than silently, but the baseline path would fail vacuously.
  'scripts/check-migration-ledger-parity.py',
  'supabase/migration-ledger-baseline.json',
  // CTL-050 / SEC-136. Both are reached ONLY through `SRC` in
  // tests/scripts/audit-summary.test.js, so without seeding they would not
  // survive a regeneration (gotcha #31). audit-summary.py is the reader whose
  // absence used to be indistinguishable from a clean audit — the key going
  // missing would make its test compare against `undefined`.
  'scripts/audit-summary.py',
  'scripts/audit-to-email.py',
  // CTL-051 / KAN-415 C2. Reached ONLY via `SRC` in
  // tests/scripts/check-module-layering.test.js, so without seeding it does
  // not survive a regeneration (gotcha #31). It is also the
  // registry's `implementation` value, so the assertion IS the path — a
  // literal in the test would let a rename read as a pass against a control
  // nobody runs.
  'scripts/check-module-layering.py',
  // CTL-053 / KAN-415 C2. Reached ONLY via `SRC` in
  // tests/scripts/check-module-api.test.js, and it is also the registry's
  // `implementation` value and the path pr-checks must name — so the assertion
  // IS the path. A literal in the test would let a rename read as a pass
  // against a control nobody runs.
  'scripts/check-module-api.py',
  // CTL-054 / KAN-415 C2. Reached ONLY via `SRC` in
  // tests/scripts/check-edge-safe.test.js, and it is the registry's
  // `implementation` value and the path pr-checks must name — the assertion IS
  // the path, so a literal would let a rename read as a pass.
  'scripts/check-edge-safe.py',
  // CTL-051 rule 3. The fixture target for "a downward edge nobody declared":
  // observability is L1, dashboard is L3, and dashboard does not declare it —
  // so the edge is legal by LAYER and only rule 3 can see it. No counted test
  // hard-codes this path, so without the seed the key vanishes on the next
  // regeneration and the fixture would silently target `undefined`, which
  // `owner_of` answers "no module" for. That inverts the test into one that
  // asserts a clean result.
  'src/modules/observability/metrics.ts',
  // SEC-105. All reached ONLY via `SRC` in tests/scripts/npm-audit-gate.test.js.
  // The checker path is also the registry's `implementation` value and the one
  // the workflows must name, so the assertion IS the path — a literal in the
  // test would let a rename read as a pass against a gate nobody runs. The four
  // deploy workflows are seeded because the test asserts a NEGATIVE about them
  // (no `npm audit` line), and gotcha #31's trap is that a negative assertion
  // against `undefined` passes forever.
  // (The waiver file itself lives under `security/`, which the generator does
  // not harvest — its prefix list is src|supabase|scripts|public|design|.github
  // — so it is a named constant in the test instead, exactly as
  // modules-layering-baseline.json is. Seeding it here would fail the
  // manifest-integrity check, which asserts every seed is actually present.)
  'scripts/check-npm-audit-gate.py',
  '.github/workflows/deploy-dev.yml',
  '.github/workflows/deploy-staging.yml',
  '.github/workflows/deploy-beta.yml',
  '.github/workflows/deploy-production.yml',
  '.github/workflows/security-audit.yml',
  // CTL-055. Both reached ONLY via `SRC` in
  // tests/scripts/check-module-table-ownership.test.js. The baseline is seeded
  // as well as the script because the test asserts POSITIVE facts about its
  // shape (two-way ratchet, computed concentration) — and gotcha #31 would turn
  // a lost key into `resolve(root, undefined)`, which reads like a broken
  // harness rather than a missing entry.
  'scripts/check-module-table-ownership.py',
  'supabase/table-ownership-baseline.json',
  // CTL-056. Same reasoning as CTL-055 above: both are reached only via
  // `SRC` in tests/scripts/check-route-thinness.test.js, and the baseline is
  // seeded too because the test asserts positive facts about its shape (the
  // computed totals, and that every baselined path is still tracked).
  // CTL-076 / KAN-459. Reached only via `SRC` in
  // tests/scripts/check-pooled-eq-mock.test.js, so without seeding it does not
  // survive a regeneration (gotcha #31). The checker path is also the registry's
  // `implementation` value and the string pr-checks.yml must name, so the
  // assertion IS the path - a literal in the test would let a rename read as a
  // pass against a control nobody runs.
  //
  // Its BASELINE is deliberately not seeded: the generator harvests only src,
  // supabase, scripts, public, design and .github literals, so no tests/ key can
  // exist, and seeding one would fail source-path-manifest-integrity's "every
  // seed is in the manifest" assertion. The test carries that one literal
  // directly, which the F4 raw-literal ratchet also does not count.
  'scripts/check-pooled-eq-mock.py',
  'scripts/check-route-thinness.py',
  'supabase/route-thinness-baseline.json',
  // The directory CTL-056 scans. A DIRECTORY rather than a file, and seeded
  // for the same reason as the two above: the fixtures in
  // tests/scripts/check-route-thinness.test.js must live under a path of this
  // name (the checker runs `git ls-files src/app`), and writing it as a literal
  // in the test would feed the shrink-only F4 raw-literal ratchet. The ratchet
  // deliberately excludes tests/support/**, so this is the layer it belongs in.
  'src/app',
  // CTL-062 / SEC-146. Both reached ONLY via `SRC` in
  // tests/scripts/check-run-log-freshness.test.js, so without seeding they do
  // not survive a regeneration (gotcha #31). The checker path is also the
  // registry's `implementation` value and the string the workflow must name, so
  // the assertion IS the path — a literal in the test would let a rename read as
  // a pass against a control nobody runs.
  //
  // Note what is deliberately NOT seeded: the three run-log documents and the
  // Control Room mirror. The generator harvests only src, supabase, scripts,
  // public, design and .github, so no `docs/` key can ever exist, and seeding
  // one would fail source-path-manifest-integrity's "every seed is in the
  // manifest" assertion. They stay raw literals in the test, which is free —
  // the F4 raw-literal ratchet counts the same six prefixes and not `docs/`.
  'scripts/check-run-log-freshness.py',
  '.github/workflows/routine-evidence.yml',
  // CTL-066 / SEC-106. All three reached ONLY via `SRC` in
  // tests/scripts/check-required-checks.test.js. The expectation file matters
  // most: the test asserts positive facts about its CONTENT (that `main`
  // requires the `guard` context by name), and gotcha #31 would turn a lost key
  // into `resolve(root, undefined)` — an error that reads like a broken
  // harness rather than a missing entry. The workflow is seeded because the
  // assertion IS the path: a rename would otherwise let the suite pass against
  // a scheduled run that no longer exists.
  'scripts/check-required-checks.py',
  '.github/expected-protection.json',
  '.github/workflows/required-checks.yml',
  '.github/workflows/main-chain-guard.yml',
  // CTL-061 (BUGS-81). Reached only via `SRC` in
  // tests/scripts/check-heartbeat-page-id.test.js, so gotcha #31 would turn a
  // lost key into `resolve(root, undefined)`. The guard's anchor doc
  // (docs/OPS_ROUTINES_CONTROL_ROOM.md) is deliberately NOT seeded here —
  // `docs/` is not one of the roots LITERAL_RE admits, so a seed for it could
  // never be harvested and would dangle. That test names it directly.
  'scripts/check-heartbeat-page-id.py',

  // CTL-064 / SEC-99 — no committed script pushes to a release branch.
  // Seeded for the same reason as the two above: the test reaches the checker
  // only through `SRC`, so without a literal here the key would vanish on the
  // next regeneration and `spawnSync(undefined)` would read as a broken
  // harness rather than a lost control (gotcha #31).
  'scripts/check-release-branch-push.py',

  // CTL-065 / SEC-153 — production deploy drift ("main moving is not
  // production changing"). Seeded for the same reason as the three above: the
  // test reaches the checker only through `SRC`, so without a literal here the
  // key would vanish on the next regeneration and `execFileSync(undefined)`
  // would read as a broken harness rather than a lost control (gotcha #31).
  'scripts/check-production-deploy-drift.py',

  // CTL-068 / SEC-158 — a recorded secret ABSENCE is still real. Seeded for
  // the same reason as the four above: the test reaches the checker only
  // through `SRC`, so without a literal here the key would vanish on the next
  // regeneration and `execFileSync(undefined)` would read as a broken harness
  // rather than a lost control (gotcha #31).
  'scripts/check-absent-secret-probe.py',

  // CTL-069 / BUGS-103 — soak verdicts must be extracted and testable. Seeded
  // for the same reason as the five above: the test reaches the checker only
  // through `SRC`, so without a literal here the key would vanish on the next
  // regeneration and `execFileSync(undefined)` would read as a broken harness
  // rather than a lost control (gotcha #31).
  'scripts/check-soak-classifier-coverage.py',

  // CTL-071 / SEC-151 — a committed schema snapshot must still match what its
  // own database would generate. Seeded for the same reason as the six above:
  // the test reaches the checker only through `SRC`, so without a literal here
  // the key would vanish on the next regeneration and `execFileSync(undefined)`
  // would read as a broken harness rather than a lost control (gotcha #31).
  'scripts/check-snapshot-regeneration.py',
] as const;
