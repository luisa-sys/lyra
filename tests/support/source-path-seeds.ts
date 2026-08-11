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
  'src/lib/age/self-declaration.ts',
  // Where D4 moved the gating that decides where a new user lands.
  'src/modules/access/pipeline.ts',
  // The Supabase client the signup and confirm paths run through.
  'src/modules/platform/supabase-server.ts',
  // D5 moved this out of src/lib/features/. Read by SRC in
  // global-enforcement.test.ts and kan342-gift-visibility.test.ts, and by
  // literal in neither — so without this seed the key does not come back.
  // See "A MOVE BREAKS THE SELF-SUSTAINING LOOP" below.
  'src/modules/features/entitlements-service.ts',
] as const;
