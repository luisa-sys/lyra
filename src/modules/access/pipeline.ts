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
import { NextResponse, type NextRequest } from 'next/server';
import { buildCspReportOnly } from '@/modules/guards/security-headers';
import {
  buildDeployContext,
  createEdgeContext,
  type AuthedContext,
  type EdgeContext,
  type MiddlewareEnvRaw,
} from './context';
import { generateCspNonce, stampCspReportOnly } from './csp';
import { establishSession } from './session';
import { runGates, type Gate } from './gate';
import { authRateLimit } from './gates/auth-rate-limit';
import { betaOauth404 } from './gates/beta-oauth-404';
import { pkceCodeRedirect } from './gates/pkce-code-redirect';
import { adminHost } from './gates/admin-host';
import { authPageRedirect } from './gates/auth-page-redirect';
import { betaTier } from './gates/beta-tier';
import { protectedRoute } from './gates/protected-route';
import { suspension } from './gates/suspension';

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

/** Every authed gate that exists, keyed by id. Not an order. */
export const AUTHED_GATES: Readonly<Record<string, Gate<AuthedContext>>> = {
  [adminHost.id]: adminHost,
  [suspension.id]: suspension,
  [betaTier.id]: betaTier,
  [protectedRoute.id]: protectedRoute,
  [authPageRedirect.id]: authPageRedirect,
};

/**
 * The order they run in. Three of these orderings are behaviour with
 * consequences, all pinned behaviourally in middleware-gate-order.test.ts:
 *
 *   admin-host BEFORE beta-tier — the admin branch RETURNS, so an operator
 *     whose own profile is not `live` still reaches the console. Without this
 *     ordering, enabling the beta gate locks out the person who would fix it.
 *   suspension BEFORE beta-tier — a suspended user lands on /suspended, not
 *     /waitlist.
 *   beta-tier BEFORE auth-page-redirect — an ineligible user is bounced to
 *     /waitlist rather than sent to /dashboard and bounced from there.
 */
export const AUTHED_ORDER: readonly string[] = [
  'admin-host',
  'suspension',
  'beta-tier',
  'protected-route',
  'auth-page-redirect',
];

export const AUTHED_PIPELINE: readonly Gate<AuthedContext>[] = AUTHED_ORDER.map((id) => {
  const gate = AUTHED_GATES[id];
  if (!gate) throw new Error(`AUTHED_ORDER names an unknown gate: ${id}`);
  return gate;
});

/**
 * The pairwise orderings that are SECURITY OR CORRECTNESS invariants, as data.
 *
 * Complementary to the exact-order test rather than a substitute for it:
 * exact-order catches EVERY change to the sequence, this says WHICH changes are
 * catastrophic and why. A reviewer looking at a reordered array can read this
 * and know in seconds whether the change is cosmetic or a live security
 * regression.
 *
 * Each is resolved to indices and asserted `before < after`, so a constraint
 * naming a gate that no longer exists fails loudly rather than passing
 * vacuously.
 */
export interface OrderConstraint {
  readonly pipeline: 'pre-auth' | 'authed';
  readonly before: string;
  readonly after: string;
  readonly ticket: string;
  readonly why: string;
}

export const ORDER_CONSTRAINTS: readonly OrderConstraint[] = [
  {
    pipeline: 'pre-auth',
    before: 'beta-oauth-404',
    after: 'auth-rate-limit',
    ticket: 'SEC-36',
    why:
      'The 404 must not be reachable by staying under a rate limit. It closes an ' +
      "unauthenticated DCR write into PRODUCTION's oauth_clients — beta runs on the " +
      'prod Supabase project (gotcha #19).',
  },
  {
    pipeline: 'pre-auth',
    before: 'pkce-code-redirect',
    after: 'auth-rate-limit',
    ticket: 'KAN-88',
    why:
      'A PKCE exchange must reach /auth/callback. Rate-limiting it first would ' +
      'strand a user mid-login with no session and no way to acquire one.',
  },
  {
    pipeline: 'authed',
    before: 'admin-host',
    after: 'beta-tier',
    ticket: 'KAN-309',
    why:
      'The admin branch RETURNS. An operator whose own profile is not `live` must ' +
      'still reach the console — otherwise enabling the beta gate locks out the ' +
      'person who would fix it.',
  },
  {
    pipeline: 'authed',
    before: 'suspension',
    after: 'beta-tier',
    ticket: 'KAN-319',
    why: 'A suspended user must land on /suspended, not /waitlist.',
  },
  {
    pipeline: 'authed',
    before: 'beta-tier',
    after: 'auth-page-redirect',
    ticket: 'KAN-175',
    why:
      'An ineligible user belongs at /waitlist. Sending them to /dashboard first ' +
      'would bounce them through the beta gate a second time.',
  },
];

/**
 * ── THE COMPOSITION ROOT ───────────────────────────────────────────────────
 *
 * The entire request path, as a factory. src/middleware.ts becomes a call to
 * this plus its env reader plus `config`, and — the point — HAS NO FUNCTION
 * BODY LEFT.
 *
 * That is not tidiness. Through D5-D9 this file's neighbours get rewritten
 * repeatedly, and the cheapest way to "just handle one more case" is to open
 * src/middleware.ts and insert `if (x) return y;` above the pipeline. Every
 * ordering test would still pass: the gates still run in order, they are simply
 * no longer the only thing that runs. With no body there is nowhere to put it,
 * and adding one is a visible structural change rather than a one-line edit.
 *
 * The fail-open when Supabase is unconfigured stays HERE rather than becoming a
 * gate, for the same reason establishSession is not one: it is a precondition
 * of the authed pipeline existing at all, and a gate lives in an ordered list
 * where it could be moved above the pre-auth gates that must not depend on it.
 */
export function createAccessMiddleware(readEnv: () => MiddlewareEnvRaw) {
  return async function middleware(request: NextRequest): Promise<NextResponse> {
    const deploy = buildDeployContext(readEnv());

    // Lazy: the SEC-36 404 returns before any document is served and must not
    // pay for a nonce it will never use. A getRandomValues spy asserts it.
    let cspCache: string | undefined;
    const csp = (): string => {
      if (cspCache === undefined) cspCache = buildCspReportOnly(generateCspNonce());
      return cspCache;
    };

    const edge = createEdgeContext(request, deploy, csp);
    const preAuth = await runGates(PRE_AUTH_PIPELINE, edge);
    if (preAuth !== null) return preAuth;

    const { supabaseUrl, supabaseAnonKey } = deploy;
    if (!supabaseUrl || !supabaseAnonKey) {
      // Fail OPEN: no Supabase means no auth gates at all. Correct for local
      // and CI boots that have no credentials, and it means the security
      // posture below is exactly as strong as the presence of two environment
      // variables. Pinned by middleware-gate-order.test.ts.
      return stampCspReportOnly(NextResponse.next(), csp());
    }

    const { supabase, user, res } = await establishSession(request, supabaseUrl, supabaseAnonKey);

    const authed: AuthedContext = { ...edge, supabase, user, res };
    const authedOutcome = await runGates(AUTHED_PIPELINE, authed);
    if (authedOutcome !== null) return authedOutcome;

    // res.current, not a captured value — the cookie callback rebuilt it
    // during getUser(). See session.ts.
    return stampCspReportOnly(res.current, csp());
  };
}
