import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { INVITE_COOKIE, INVITE_COOKIE_MAX_AGE } from '@/lib/beta-access/invite-cookie';

/**
 * KAN-337 — beta-invite deep-link. `/join?code=<INVITE_CODE>` is the shareable
 * link beta users hand out. A valid code is stowed in a short-lived httpOnly
 * cookie (so it survives the Google-OAuth round-trip — resolveBetaAccess reads
 * it on the callback) and the visitor lands on the sign-up page with the
 * "you're invited" banner. Sign-up (email or Google) then re-validates the code
 * server-side and grants beta, skipping the waitlist. An absent/wrong code just
 * drops the visitor on the normal sign-up page (no cookie, no banner).
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = (url.searchParams.get('code') ?? '').trim();
  const configured = env.inviteCode();
  const valid = !!configured && code === configured;

  const dest = new URL('/signup', url.origin);
  if (valid) dest.searchParams.set('invited', '1');

  const res = NextResponse.redirect(dest);
  if (valid) {
    res.cookies.set(INVITE_COOKIE, code, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: INVITE_COOKIE_MAX_AGE,
      path: '/',
    });
  }
  return res;
}
