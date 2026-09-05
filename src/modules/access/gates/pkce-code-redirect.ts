/**
 * Supabase PKCE — hand a `?code=` on the root path to the callback route.
 *
 * Lifted verbatim from src/middleware.ts.
 *
 * Runs before the beta/tier gate, and that ordering is behaviour rather than
 * taste: a user mid-exchange holds a code but has no session yet. Bounce them
 * to /waitlist before /auth/callback runs and the session never forms, so they
 * can never become `live` and never stop being bounced. That is a login loop,
 * not a redirect. Pinned by middleware-gate-order.test.ts.
 */
import { NextResponse } from 'next/server';
import type { EdgeContext } from '../context';
import type { Gate } from '../gate';

export const pkceCodeRedirect: Gate<EdgeContext> = {
  id: 'pkce-code-redirect',
  ticket: 'KAN-88',
  why: 'A PKCE exchange must reach /auth/callback before any gate can know who you are.',
  run: (ctx) => {
    const code = ctx.request.nextUrl.searchParams.get('code');
    if (!code || ctx.pathname !== '/') return null;
    const url = ctx.request.nextUrl.clone();
    url.pathname = '/auth/callback';
    return NextResponse.redirect(url);
  },
};
