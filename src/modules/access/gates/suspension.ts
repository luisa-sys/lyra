/**
 * KAN-319 — a suspended user is blocked from their own session.
 *
 * Lifted verbatim from src/middleware.ts, including the fail-open decision and
 * its reasoning, which is the load-bearing part of this gate:
 *
 *   Never fail silently on a lookup error. We fail OPEN here (let the request
 *   proceed) rather than closed, because a suspended user's public exposure is
 *   already prevented at the data tier by RLS (published-and-not-suspended), so
 *   this gate only governs their own session — and failing closed on a
 *   transient profiles-read error would wrongly lock out the whole
 *   authenticated userbase.
 *
 * Runs BEFORE the beta/tier gate so a suspended user lands on /suspended rather
 * than /waitlist. That ordering is asserted behaviourally in
 * middleware-gate-order.test.ts, where moving this gate below the beta gate
 * reddens exactly one test.
 *
 * ⚠️ The console.error signature is pinned by that suite:
 *   toHaveBeenCalledWith(stringContaining('failing open'), 'connection reset')
 * Two arguments, and the message must contain "failing open". Reformatting it
 * into one interpolated string breaks a test that exists precisely because a
 * silent fail-open is indistinguishable from no gate at all.
 */
import { NextResponse } from 'next/server';
import type { AuthedContext } from '../context';
import { isExemptFrom } from '../exemptions';
import type { Gate } from '../gate';

export const suspension: Gate<AuthedContext> = {
  id: 'suspension',
  ticket: 'KAN-319',
  why: 'A suspended user must not continue using the app from their own session.',
  run: async (ctx) => {
    const { user } = ctx;
    // The exemption check is INSIDE the user guard, not eagerly at the top as
    // it was inline. Unobservable — isExemptFrom is a pure predicate — and it
    // is where the real per-request saving is: anonymous traffic no longer
    // computes an exemption it will never consult.
    if (!user || isExemptFrom('suspension', ctx.pathname)) return null;

    const { data: suspProfile, error: suspErr } = await ctx.supabase
      .from('profiles')
      .select('is_suspended')
      .eq('user_id', user.id)
      .maybeSingle();

    if (suspErr) {
      console.error('[middleware] suspension lookup failed (failing open):', suspErr.message);
    }
    if (!suspProfile?.is_suspended) return null;

    const url = ctx.request.nextUrl.clone();
    url.pathname = '/suspended';
    url.search = '';
    return NextResponse.redirect(url);
  },
};
