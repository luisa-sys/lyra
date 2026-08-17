/**
 * The gate contract and the runner — KAN-415 D4.
 *
 * A gate answers one question about one request: "do I terminate this, and if
 * so with what response?" `null` means continue. That is the whole protocol.
 *
 * ⚠️ `run` IS DECLARED AS A PROPERTY, NOT A METHOD SHORTHAND. This is
 * load-bearing and easy to undo by accident.
 *
 *     readonly run: (ctx: Ctx) => GateOutcome        // property  — CONTRAVARIANT
 *     run(ctx: Ctx): GateOutcome                     // shorthand — BIVARIANT
 *
 * Under `strictFunctionTypes` (tsconfig has `strict: true`) a property-declared
 * function parameter is checked contravariantly, so `Gate<AuthedContext>` is
 * NOT assignable to `Gate<EdgeContext>` — putting the suspension or beta-tier
 * gate into the pre-authentication pipeline becomes a COMPILE ERROR.
 *
 * Written as a method shorthand, TypeScript checks parameters bivariantly for
 * historical reasons, the assignment is accepted, and the guarantee silently
 * evaporates while the code still reads as though it holds. Whoever "tidies"
 * this into shorthand will not see anything break.
 *
 * WHY ORDER IS NOT DATA
 * ---------------------
 * The pipelines below are ordered arrays, and it is tempting to call that
 * "order as data". It is not, and the distinction matters: the ARRAYS are data,
 * but which array a gate may appear in is a TYPE, and the sequence within an
 * array is a behavioural contract pinned by tests, not a configuration knob.
 * See exemptions.ts for the converse — exemption genuinely is order-free data.
 */
import type { NextResponse } from 'next/server';

/** `null` continues to the next gate. Anything else terminates the request. */
export type GateOutcome = NextResponse | null;

export interface Gate<Ctx> {
  /** Stable identifier. Used by tests to assert the pipeline's contents and order. */
  readonly id: string;
  /** The ticket that explains why this gate exists at all. */
  readonly ticket: string;
  /** One sentence: what this gate protects, in terms of a user or an attacker. */
  readonly why: string;
  /** ⚠️ Property, not shorthand — see the file header. */
  readonly run: (ctx: Ctx) => GateOutcome | Promise<GateOutcome>;
}

/**
 * Run gates in order; the first non-null outcome wins.
 *
 * The thenable probe rather than a blanket `await`: most gates are synchronous
 * (a path check, an env check), and `await` on a non-promise still schedules a
 * microtask. This runs on EVERY request in the edge runtime, so the synchronous
 * ones stay synchronous.
 */
export async function runGates<Ctx>(
  pipeline: readonly Gate<Ctx>[],
  ctx: Ctx,
): Promise<GateOutcome> {
  for (let i = 0; i < pipeline.length; i += 1) {
    const outcome = pipeline[i].run(ctx);
    const resolved =
      outcome !== null && typeof (outcome as Promise<GateOutcome>)?.then === 'function'
        ? await (outcome as Promise<GateOutcome>)
        : (outcome as GateOutcome);
    if (resolved !== null) return resolved;
  }
  return null;
}
