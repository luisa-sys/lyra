/**
 * The gate pipelines — KAN-415 D4.
 *
 * TWO PIPELINES, SPLIT AT A NAMED BOUNDARY
 * ----------------------------------------
 * `PRE_AUTH_PIPELINE` runs against an `EdgeContext`: no user, no Supabase
 * client, no database. `AUTHED_PIPELINE` runs against an `AuthedContext`, after
 * the session boundary.
 *
 * The split is enforced by the type system, not by convention. `Gate.run` is
 * declared as a PROPERTY in gate.ts, so under `strictFunctionTypes` a
 * `Gate<AuthedContext>` is not assignable to `Gate<EdgeContext>` — adding the
 * suspension gate to the pre-auth array is a compile error rather than a
 * silently reordered security control. See gate.ts for why the declaration form
 * matters and how "tidying" it undoes the guarantee.
 *
 * ORDER WITHIN AN ARRAY IS BEHAVIOUR
 * ----------------------------------
 * These arrays are ordered, and the order is not a preference. Every ordering
 * below is asserted from the outside, through the real `middleware`, in
 * tests/unit/middleware-gate-order.test.ts — where four separate reorderings
 * each redden exactly one test. The registry/order set-equality test below is a
 * cheaper, earlier signal: it catches a gate that was written and never wired,
 * or wired twice, before anything has to run.
 */
import type { AuthedContext, EdgeContext } from './context';
import type { Gate } from './gate';
import { authRateLimit } from './gates/auth-rate-limit';
import { betaOauth404 } from './gates/beta-oauth-404';
import { pkceCodeRedirect } from './gates/pkce-code-redirect';

/** Every pre-auth gate that exists, keyed by id. Not an order. */
export const PRE_AUTH_GATES: Readonly<Record<string, Gate<EdgeContext>>> = {
  [betaOauth404.id]: betaOauth404,
  [pkceCodeRedirect.id]: pkceCodeRedirect,
  [authRateLimit.id]: authRateLimit,
};

/**
 * The order they run in. Stated separately from the registry so that "which
 * gates exist" and "in what sequence" are two reviewable facts rather than one
 * array where a reordering hides among additions.
 *
 * beta-oauth-404 is FIRST, and that is the ordering with security consequences:
 * it must not be reachable by staying under a rate limit, and it must not
 * depend on auth state. See gates/beta-oauth-404.ts.
 */
export const PRE_AUTH_ORDER: readonly string[] = [
  'beta-oauth-404',
  'pkce-code-redirect',
  'auth-rate-limit',
];

export const PRE_AUTH_PIPELINE: readonly Gate<EdgeContext>[] = PRE_AUTH_ORDER.map((id) => {
  const gate = PRE_AUTH_GATES[id];
  // Fail at module load, not per request: a typo'd id would otherwise put
  // `undefined` in the pipeline and throw on the first request in production.
  if (!gate) throw new Error(`PRE_AUTH_ORDER names an unknown gate: ${id}`);
  return gate;
});

/** Placeholder for C7 — the authed pipeline is assembled once its gates exist. */
export const AUTHED_GATES: Readonly<Record<string, Gate<AuthedContext>>> = {};
export const AUTHED_ORDER: readonly string[] = [];
export const AUTHED_PIPELINE: readonly Gate<AuthedContext>[] = [];
