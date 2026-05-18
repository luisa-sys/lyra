/**
 * Microsoft OAuth callback — KAN-211 P7.
 *
 * Handles the redirect from Microsoft's consent screen. Validates state,
 * exchanges the authorization code for tokens, fetches /me to capture
 * provider_account_id + display_name, and upserts the oauth_connections
 * row.
 *
 * Mirrors the Google callback's diagnostic logging shape.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { isConveneEnabled } from '@/lib/convene/flags';
import { upsertConnection } from '@/lib/convene/oauth-connections';
import {
  exchangeCodeForTokens,
  fetchUserInfo,
  type MicrosoftTokenResponse,
} from '@/lib/convene/microsoft/oauth';

export const maxDuration = 30;

function logStep(reqId: string, step: string, extra?: Record<string, unknown>) {
  console.log(
    JSON.stringify({ at: 'convene/oauth/microsoft/callback', req: reqId, step, ...extra })
  );
}

export async function GET(req: NextRequest) {
  const reqId = Math.random().toString(36).slice(2, 10);
  logStep(reqId, 'enter');

  if (!isConveneEnabled()) {
    return NextResponse.json({ error: 'convene_disabled' }, { status: 404 });
  }

  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const errorParam = req.nextUrl.searchParams.get('error');
  const errorDesc = req.nextUrl.searchParams.get('error_description');
  logStep(reqId, 'params', {
    has_code: !!code,
    has_state: !!state,
    error: errorParam,
    error_description: errorDesc?.slice(0, 200),
  });

  if (errorParam) {
    return NextResponse.redirect(
      new URL(`/dashboard?convene_oauth=error&reason=${encodeURIComponent(errorParam)}`, req.url)
    );
  }
  if (!code || !state) {
    return NextResponse.json({ error: 'missing_code_or_state' }, { status: 400 });
  }

  const admin = createSupabaseAdmin(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false },
  });

  // ownership-ok: state token is unguessable + single-use (KAN-211)
  const { data: stateRow, error: stateErr } = await admin
    .from('oauth_connect_state')
    .select('user_id, provider, expires_at')
    .eq('state', state)
    .maybeSingle();
  logStep(reqId, 'state_lookup_done', { found: !!stateRow, err: stateErr?.message });

  if (stateErr || !stateRow) {
    return NextResponse.json({ error: 'bad_state' }, { status: 400 });
  }
  if (new Date(stateRow.expires_at) < new Date()) {
    await admin.from('oauth_connect_state').delete().eq('state', state);
    return NextResponse.json({ error: 'state_expired' }, { status: 400 });
  }
  if (stateRow.provider !== 'microsoft') {
    return NextResponse.json({ error: 'state_provider_mismatch' }, { status: 400 });
  }
  await admin.from('oauth_connect_state').delete().eq('state', state);

  let tokens: MicrosoftTokenResponse;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    logStep(reqId, 'token_exchange_failed', { msg });
    return NextResponse.json({ error: 'token_exchange_failed', detail: msg }, { status: 502 });
  }

  if (!tokens.refresh_token) {
    return NextResponse.json(
      {
        error: 'no_refresh_token',
        hint: 'offline_access scope is required — check Azure AD app config',
      },
      { status: 400 }
    );
  }

  let userInfo;
  try {
    userInfo = await fetchUserInfo(tokens.access_token);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    logStep(reqId, 'userinfo_failed', { msg });
    return NextResponse.json({ error: 'userinfo_failed', detail: msg }, { status: 502 });
  }

  try {
    await upsertConnection({
      userId: stateRow.user_id,
      provider: 'microsoft',
      providerAccountId: userInfo.id,
      displayName: userInfo.mail ?? userInfo.userPrincipalName ?? userInfo.displayName,
      refreshToken: tokens.refresh_token,
      scopeGranted: tokens.scope,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    logStep(reqId, 'upsert_failed', { msg });
    return NextResponse.json({ error: 'persist_failed', detail: msg }, { status: 500 });
  }

  // ownership-ok: audit for verified state user (KAN-211)
  await admin.from('consent_log').insert({
    user_id: stateRow.user_id,
    event_type: 'oauth_granted',
    subject_kind: 'provider',
    subject_id: 'microsoft',
    metadata: {
      scope: tokens.scope,
      account: userInfo.mail ?? userInfo.userPrincipalName ?? userInfo.id,
    },
  });

  return NextResponse.redirect(
    new URL('/dashboard?convene_oauth=connected&provider=microsoft', req.url)
  );
}
