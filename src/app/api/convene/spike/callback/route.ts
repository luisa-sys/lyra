/**
 * SPIKE — KAN-204. Throwaway. Replaced by /api/convene/oauth/google/callback
 * in P2 (KAN-206).
 *
 * Handles the Google OAuth redirect, exchanges code for tokens, vaults the
 * refresh token, and persists a single row in the throwaway spike table.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseServer } from '@/lib/supabase-server';
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { isConveneSpikeAllowed } from '@/lib/convene/flags';
import { exchangeCodeForTokens } from '@/lib/convene/google/oauth';
import { vaultStoreRefreshToken } from '@/lib/convene/vault';

export async function GET(req: NextRequest) {
  if (!isConveneSpikeAllowed()) {
    return NextResponse.json({ error: 'not_available' }, { status: 404 });
  }

  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const cookieState = req.cookies.get('convene_spike_oauth_state')?.value;

  if (!code || !state || state !== cookieState) {
    return NextResponse.json({ error: 'bad_state' }, { status: 400 });
  }

  const sb = await createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const tokens = await exchangeCodeForTokens(code);
  if (!tokens.refresh_token) {
    return NextResponse.json(
      { error: 'no_refresh_token', hint: 'force prompt=consent and try again' },
      { status: 400 }
    );
  }

  const secretId = await vaultStoreRefreshToken(
    tokens.refresh_token,
    `convene-spike user=${user.id}`
  );

  // Write to throwaway spike table via service role (RLS bypassed deliberately
  // for the spike; the real P1 implementation will use proper user-scoped RLS).
  const admin = createSupabaseAdmin(
    env.supabaseUrl(),
    env.supabaseServiceRoleKey(),
    { auth: { persistSession: false } }
  );
  const { error: insertErr } = await admin
    .from('convene_spike_oauth_connections')
    .upsert({
      user_id: user.id,
      provider: 'google',
      refresh_token_secret_id: secretId,
      scope_granted: tokens.scope,
    });
  if (insertErr) {
    return NextResponse.json(
      { error: 'persist_failed', detail: insertErr.message },
      { status: 500 }
    );
  }

  const res = NextResponse.redirect(
    new URL('/dashboard?convene_spike=connected', req.url)
  );
  res.cookies.delete('convene_spike_oauth_state');
  return res;
}
