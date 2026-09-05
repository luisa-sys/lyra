/**
 * Authenticated users are redirected away from the auth pages.
 *
 * Lifted verbatim from src/middleware.ts, including the KAN-175 note: on beta,
 * an ineligible user belongs at /waitlist rather than /dashboard — but sending
 * them to /dashboard is correct here, because the beta gate ABOVE this one has
 * already run and would have bounced them. Routing them straight to /waitlist
 * from here would duplicate that decision in two places.
 */
import { NextResponse } from 'next/server';
import type { AuthedContext } from '../context';
import type { Gate } from '../gate';

export const authPageRedirect: Gate<AuthedContext> = {
  id: 'auth-page-redirect',
  ticket: 'KAN-175',
  why: 'A signed-in user landing on /login or /signup should be taken to the app.',
  run: (ctx) => {
    const { user } = ctx;
    const p = ctx.request.nextUrl.pathname;
    if (user && (p === '/login' || p === '/signup')) {
      const url = ctx.request.nextUrl.clone();
      url.pathname = '/dashboard';
      return NextResponse.redirect(url);
    }
    return null;
  },
};
