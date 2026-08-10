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
] as const;
