/**
 * The per-rule severity dial for `.dependency-cruiser.cjs` (KAN-414 F3 / KAN-415).
 *
 * WHY THIS IS ITS OWN MODULE
 * --------------------------
 * It used to be three lines inside the config, and the only test of it was an
 * indirect one: `dependency-rules-severity.test.js` asserted that
 * `no-cross-segment-app` resolved to `warn`, as the CONTRAST CASE proving the
 * dial genuinely varies — because if every rule resolved to `error`, then
 * "no-module-to-app is error under DEPCRUISE_SEVERITY=warn" would be trivially
 * true and would prove nothing about the mechanism.
 *
 * That contrast depended on a rule being UNFINISHED. KAN-415 finished the last
 * one, so the only evidence that the dial still has two branches was about to
 * disappear at exactly the moment every rule started blocking — and from then
 * on, replacing this with `() => 'error'` would have been invisible. A future
 * rule added as NOT_YET would then block on day one instead of reporting, which
 * is how a gate gets reverted wholesale instead of fixed.
 *
 * So the mechanism is tested directly here instead of being inferred from
 * whichever rules happen to be incomplete. The test no longer needs unfinished
 * work to exist in order to prove finished work is enforced.
 *
 * ⚠️ `DEPCRUISE_SEVERITY` is read at CALL time, not at module load. The config
 * builds its rule list at load, so the two are equivalent there — but reading it
 * at call time means a test can flip the variable without depending on jest's
 * module registry being reset correctly, which is a trap this suite has already
 * been caught by once (see the `loadConfig` note in the test).
 */

/** A rule measured at zero violations: it blocks. */
const BLOCKING = true;

/**
 * A rule with known, ticketed, elsewhere-owned violations: it reports.
 *
 * Currently unused — every rule is at zero. It is deliberately kept rather than
 * deleted: it is the vocabulary for landing the NEXT rule in reporting mode,
 * and `severityFor(NOT_YET)` is asserted by the tests, so it cannot rot.
 */
const NOT_YET = false;

/**
 * Per-rule severity. A rule at zero violations should block; a rule with known
 * violations should warn. Collapsing both into one dial means the cleanest rule
 * gets no enforcement until the messiest one is finished, which is how a gate
 * spends months reporting and preventing nothing.
 *
 * `DEPCRUISE_SEVERITY=error` is a ONE-WAY override: it can force a warn rule up
 * to error, never an error rule down to warn. A gate whose env var can weaken it
 * is a gate with an off switch.
 */
function severityFor(ruleAtZero) {
  const forceError = process.env.DEPCRUISE_SEVERITY === 'error';
  return forceError || ruleAtZero ? 'error' : 'warn';
}

module.exports = { severityFor, BLOCKING, NOT_YET };
