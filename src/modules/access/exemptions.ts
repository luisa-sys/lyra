/**
 * THE exemption table — KAN-415 D4.
 *
 * src/middleware.ts carried three separate inline `||` chains asking "is this
 * path exempt from this gate": 4 disjuncts for the admin-host passthrough, 5
 * for the suspension gate, 10 for the beta/tier gate. They overlapped without
 * saying so, and a path could be added to one and forgotten in another with
 * nothing to notice.
 *
 * WHY EXEMPTION MAY BE DATA AND GATE ORDER MAY NOT
 * -----------------------------------------------
 * The next reader will reasonably ask why one programme turns one list into a
 * declarative table and insists the other stays as control flow. The answer is
 * a property of the two, not a preference:
 *
 *   Exemption is a PURE, ORDER-FREE DISJUNCTION over pathname. Reordering the
 *   rows below cannot change any answer. So the order carries no information,
 *   and a table loses nothing.
 *
 *   Gate order is NOT. Whether the suspension gate runs before the beta gate
 *   decides whether a suspended user lands on /suspended or /waitlist, and
 *   whether SEC-36's 404 runs before authentication decides whether an
 *   unauthenticated caller can reach production's oauth_clients. Order there
 *   IS the behaviour, and it stays as explicit, readable control flow.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * -----------------------------
 * `isOauthServerPath` lives in ./oauth-server-paths.ts, same vocabulary, same
 * primitive, separate export. It is an INCLUSION set — the paths SEC-36 turns
 * OFF on beta — and folding it into a table whose column header reads "exempt
 * from" is one careless edit away from a polarity inversion that disables the
 * 404 closing an unauthenticated DCR write into PRODUCTION's oauth_clients
 * (beta runs on the prod Supabase project, gotcha #19).
 *
 * The admin gate's own `!pathname.startsWith('/admin')` is also absent: that is
 * "this is already an admin path", the gate's own domain rather than an
 * exemption — and it is the literal `qa-sweep/inventory.py` derives the ADMIN
 * prefix list from.
 */
import { compile, matchesAny, type CompiledMatchers, type PathMatch } from './matchers';

export type ExemptGate = 'suspension' | 'beta-tier' | 'admin-passthrough';

interface ExemptionRow {
  readonly match: PathMatch;
  readonly gates: readonly ExemptGate[];
  readonly why: string;
}

const exact = (path: string): PathMatch => ({ kind: 'exact', path });
const prefix = (path: string): PathMatch => ({ kind: 'prefix', path });

/**
 * Eleven rows, transcribed cell-by-cell from the three original predicates.
 * Column totals MUST be suspension 5, beta-tier 10, admin-passthrough 4 —
 * asserted in exemptions.test.ts against a literal copy of the originals.
 */
export const EXEMPTIONS: readonly ExemptionRow[] = [
  {
    match: exact('/suspended'),
    gates: ['suspension', 'beta-tier'],
    why: 'KAN-319 — the suspension redirect lands here. Exempt from both gates or it loops.',
  },
  {
    match: exact('/login'),
    gates: ['suspension', 'beta-tier', 'admin-passthrough'],
    why: 'A suspended or non-live user must still be able to reach the login form.',
  },
  {
    match: prefix('/auth/'),
    gates: ['suspension', 'beta-tier', 'admin-passthrough'],
    why: 'The session exchange must complete before anything can know who you are.',
  },
  {
    match: prefix('/_next/'),
    gates: ['suspension', 'beta-tier', 'admin-passthrough'],
    why:
      'Next.js build assets. Gating them would redirect the JS and CSS of the very ' +
      'page a user is being sent to, so the destination renders unstyled and broken.',
  },
  {
    match: exact('/favicon.ico'),
    gates: ['suspension', 'beta-tier'],
    why: 'Asset. The route matcher lets it through, so the gates must too.',
  },
  {
    match: exact('/waitlist'),
    gates: ['beta-tier'],
    why:
      "The beta gate's own destination. NOT suspension-exempt: a suspended user on " +
      '/waitlist is still sent to /suspended, which is current behaviour.',
  },
  {
    match: exact('/status'),
    gates: ['beta-tier'],
    why: 'SEC-4 — public status page, never beta-gated. External monitoring depends on it.',
  },
  {
    match: exact('/signup'),
    gates: ['beta-tier'],
    why:
      'Account creation precedes tier assignment. NOT admin-passthrough — adding it ' +
      'there would change the admin rewrite.',
  },
  {
    match: exact('/join'),
    gates: ['beta-tier'],
    why: 'KAN-337 — beta-invite deep link; sets a cookie and redirects to /signup.',
  },
  {
    match: exact('/confirm-age'),
    gates: ['beta-tier'],
    why: 'The 18+ declaration is asked BEFORE the waitlist bounce, not after.',
  },
  {
    match: prefix('/api/'),
    gates: ['admin-passthrough'],
    why: 'Admin-host passthrough only — route handlers are not pages to be rewritten.',
  },
];

const GATES: readonly ExemptGate[] = ['suspension', 'beta-tier', 'admin-passthrough'];

/** Compiled once at module load, not per request. */
const COMPILED: Record<ExemptGate, CompiledMatchers> = GATES.reduce(
  (acc, gate) => {
    acc[gate] = compile(EXEMPTIONS.filter((r) => r.gates.includes(gate)).map((r) => r.match));
    return acc;
  },
  {} as Record<ExemptGate, CompiledMatchers>,
);

export function isExemptFrom(gate: ExemptGate, pathname: string): boolean {
  return matchesAny(COMPILED[gate], pathname);
}

/** Test-only introspection. Lets a test enumerate a gate's matchers without reaching into COMPILED. */
export function exemptMatchersFor(gate: ExemptGate): readonly PathMatch[] {
  return EXEMPTIONS.filter((r) => r.gates.includes(gate)).map((r) => r.match);
}
