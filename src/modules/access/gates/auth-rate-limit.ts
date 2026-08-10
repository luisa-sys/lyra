/**
 * Rate-limit POSTs to the auth endpoints.
 *
 * Lifted verbatim from src/middleware.ts, including the two details that look
 * like details and are not:
 *
 *   POST ONLY. A GET of /login is a page view; rate-limiting it would break
 *   ordinary navigation. Only form submissions are limited.
 *
 *   The key is `auth:${ip}` via getClientIp, which is SEC-120's hardened
 *   trusted-proxy resolution — not a raw header read.
 */
import { NextResponse } from 'next/server';
import { clientIp } from '@/modules/guards/client-ip';
import { rateLimit, RATE_LIMITS } from '@/modules/guards/rate-limit';
import type { EdgeContext } from '../context';
import type { Gate } from '../gate';

function isAuthEndpoint(pathname: string): boolean {
  return pathname === '/login' || pathname === '/signup' || pathname.startsWith('/auth/');
}

export const authRateLimit: Gate<EdgeContext> = {
  id: 'auth-rate-limit',
  ticket: 'SEC-12',
  why: 'Credential stuffing against the login and signup forms.',
  run: (ctx) => {
    if (!isAuthEndpoint(ctx.pathname) || ctx.request.method !== 'POST') return null;
    // clientIp takes Headers, matching the local wrapper this replaces.
    const ip = clientIp(ctx.request.headers);
    const { limited, retryAfter } = rateLimit(`auth:${ip}`, RATE_LIMITS.auth);
    if (!limited) return null;
    return NextResponse.json(
      { error: 'Too many attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
  },
};
