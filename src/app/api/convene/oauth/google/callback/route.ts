/**
 * KAN-206 — Convene OAuth callback route (Google).
 *
 * Handles the redirect from Google's consent screen. Validates state,
 * exchanges the authorization code for tokens, fetches the user's Google
 * profile to capture provider_account_id + display_name, and upserts the
 * canonical oauth_connections row.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { isConveneEnabled } from '@/lib/convene/flags';
import { exchangeCodeForTokens } from '@/lib/convene/google/oauth';
import { upsertConnection } from '@/lib/convene/oauth-connections';

interface GoogleUserInfo {
  sub: string; // stable Google account id
  email?: string;
  name?: string;
  picture?: string;
}

async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch Google userinfo (${res.status})`);
  }
  return (await res.json()) as GoogleUserInfo;
}

export async function GET(req: NextRequest) {
  if (!isConveneEnabled()) {
    return NextResponse.json({ error: 'convene_disabled' }, { status: 404 });
  }

  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const errorParam = req.nextUrl.searchParams.get('error');

  if (errorParam) {
    return NextResponse.redirect(
      new URL(`/dashboard?convene_oauth=error&reason=${encodeURIComponent(errorParam)}`, req.url)
    );
  }
  if (!code || !state) {
    return NextResponse.json({ error: 'missing_code_or_state' }, { status: 400 });
  }

  const admin = createSupabaseAdmin(
    env.supabaseUrl(),
    env.supabaseServiceRoleKey(),
    { auth: { persistSession: false } }
  );

  // Look up state — service-role read so we don't depend on the user's
  // session cookie here (Google's redirect could land before Supabase auth
  // refreshes).
  // ownership-ok: state token is unguessable, single-use, user_id is the trusted source (KAN-206)
  const { data: stateRow, error: stateErr } = await admin
    .from('oauth_connect_state')
    .select('user_id, provider, expires_at')
    .eq('state', state)
    .maybeSingle();

  if (stateErr || !stateRow) {
    return NextResponse.json({ error: 'bad_state' }, { status: 400 });
  }
  if (new Date(stateRow.expires_at) < new Date()) {
    // Clean up the expired row.
    await admin.from('oauth_connect_state').delete().eq('state', state);
    return NextResponse.json({ error: 'state_expired' }, { status: 400 });
  }
  if (stateRow.provider !== 'google') {
    return NextResponse.json({ error: 'state_provider_mismatch' }, { status: 400 });
  }

  // Single-use: delete immediately so a replay fails.
  await admin.from('oauth_connect_state').delete().eq('state', state);

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch (e) {
    return NextResponse.json(
      { error: 'token_exchange_failed', detail: e instanceof Error ? e.message : 'unknown' },
      { status: 502 }
    );
  }

  if (!tokens.refresh_token) {
    return NextResponse.json(
      { error: 'no_refresh_token', hint: 'access_type=offline + prompt=consent required' },
      { status: 400 }
    );
  }

  let userInfo: GoogleUserInfo;
  try {
    userInfo = await fetchGoogleUserInfo(tokens.access_token);
  } catch (e) {
    return NextResponse.json(
      { error: 'userinfo_failed', detail: e instanceof Error ? e.message : 'unknown' },
      { status: 502 }
    );
  }

  try {
    await upsertConnection({
      userId: stateRow.user_id,
      provider: 'google',
      providerAccountId: userInfo.sub,
      displayName: userInfo.email ?? userInfo.name,
      refreshToken: tokens.refresh_token,
      scopeGranted: tokens.scope,
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'persist_failed', detail: e instanceof Error ? e.message : 'unknown' },
      { status: 500 }
    );
  }

  // Log consent (append-only audit).
  // ownership-ok: writing audit for the verified state user (KAN-206)
  await admin.from('consent_log').insert({
    user_id: stateRow.user_id,
    event_type: 'oauth_granted',
    subject_kind: 'provider',
    subject_id: 'google',
    metadata: { scope: tokens.scope, account: userInfo.email ?? userInfo.sub },
  });

  return NextResponse.redirect(
    new URL('/dashboard?convene_oauth=connected&provider=google', req.url)
  );
}
