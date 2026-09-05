/**
 * KAN-326 — the tier-aware access gate.
 *
 * Active on the "prod family" only: the beta deploy and the real production
 * deploy. dev and staging are single full environments (deployTier null) and
 * are not gated here. An authenticated user is:
 *   - not live         -> /waitlist
 *   - live, wrong tier -> their own tier's site (beta <-> prod), so a promoted
 *                         user always lands on the right one. Sessions carry
 *                         across via the shared .checklyra.com cookie.
 *
 * Runs AFTER the suspension gate, so a suspended user reaches /suspended rather
 * than /waitlist. Pinned behaviourally in middleware-gate-order.test.ts.
 *
 * ── THE ERROR PATH, AND WHY IT LOOKS LIKE THIS ────────────────────────────
 *
 * This gate used to destructure only `{ data: profile }` and never inspect
 * `error`. A transient profiles-read failure therefore made `profile`
 * undefined, which is `!== 'live'`, which redirected a LEGITIMATE LIVE USER to
 * /waitlist — silently. No log line, no signal, and no way for that user to
 * recover: they ARE live, they simply cannot prove it while the read is
 * failing.
 *
 * The suspension gate fifty lines above was explicitly hardened against exactly
 * this ("Observability: never fail silently on a lookup error") and fails OPEN
 * with a console.error. Same read, opposite direction, no log. One of the two
 * was wrong.
 *
 * DECIDED 2026-08-09 (Luisa): FAIL CLOSED, BUT LOGGED.
 *
 * The direction stays. This gate governs ACCESS TO A GATED PRODUCT, whereas the
 * suspension gate governs a suspended user's own session — admitting an
 * unverified user to beta on a transient database error is the worse outcome,
 * so /waitlist remains the answer. What changes is the SILENCE: an error is now
 * logged, distinguishably from the ordinary not-live case, so the difference
 * between "this user is not live" and "we could not tell" is visible in the
 * logs rather than inferred from a support ticket.
 *
 * The characterisation test that pinned the silent behaviour is updated in the
 * same commit, and it now asserts the log rather than its absence.
 */
import { NextResponse } from 'next/server';
import type { AuthedContext } from '../context';
import { isExemptFrom } from '../exemptions';
import type { Gate } from '../gate';

export const betaTier: Gate<AuthedContext> = {
  id: 'beta-tier',
  ticket: 'KAN-326',
  why: 'Only live users of THIS tier may use this deploy; everyone else is routed away.',
  run: async (ctx) => {
    const { user, env } = ctx;
    // Exemption checked inside the guard, not eagerly — see suspension.ts.
    if (!env.deployTier || !user || isExemptFrom('beta-tier', ctx.pathname)) return null;

    const { data: profile, error } = await ctx.supabase
      .from('profiles')
      .select('user_status, access_tier')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      // Fail CLOSED (the redirect below still happens) but no longer SILENTLY.
      // A live user bounced by this branch cannot self-recover, so the one
      // thing that must not happen is nobody knowing it occurred.
      console.error(
        '[middleware] beta-tier lookup failed (failing closed to /waitlist):',
        error.message,
      );
    }

    if (profile?.user_status !== 'live') {
      const url = ctx.request.nextUrl.clone();
      url.pathname = '/waitlist';
      url.search = '';
      return NextResponse.redirect(url);
    }

    if (profile.access_tier !== env.deployTier) {
      const targetHost =
        profile.access_tier === 'prod' ? 'https://checklyra.com' : 'https://beta.checklyra.com';
      return NextResponse.redirect(
        new URL(`${targetHost}${ctx.pathname}${ctx.request.nextUrl.search}`),
      );
    }

    return null;
  },
};
