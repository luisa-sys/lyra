/**
 * SPIKE — KAN-204. Throwaway. Replaced by /api/convene/oauth/google/connect
 * in P2 (KAN-206).
 *
 * Initiates the Google OAuth flow for Calendar + Contacts scopes. Requires the
 * caller to be authenticated against Supabase (cookie session).
 */

import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { createClient } from '@/lib/supabase-server';
import { isConveneSpikeAllowed } from '@/lib/convene/flags';
import { buildAuthorizeUrl } from '@/lib/convene/google/oauth';

export async function GET() {
  if (!isConveneSpikeAllowed()) {
    return NextResponse.json({ error: 'not_available' }, { status: 404 });
  }

  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const state = randomBytes(24).toString('base64url');

  const res = NextResponse.redirect(buildAuthorizeUrl(state));
  res.cookies.set('convene_spike_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV !== 'development',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  return res;
}
