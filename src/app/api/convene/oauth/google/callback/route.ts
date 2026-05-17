/**
 * KAN-206 — Convene OAuth callback route (Google).
 *
 * Handles the redirect from Google's consent screen. Validates state,
 * exchanges the authorization code for tokens, fetches the user's Google
 * profile to capture provider_account_id + display_name, and upserts the
 * canonical oauth_connections row.
 *
 * Diagnostics: every step logs progress so a Cloudflare 502 (function
 * timeout) can be localised. Each external HTTP call carries an explicit
 * AbortSignal timeout so we surface a clean 502 with detail instead of
 * letting the function hang to the Vercel maxDuration.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { isConveneEnabled } from '@/lib/convene/flags';
import { upsertConnection } from '@/lib/convene/oauth-connections';
import { conveneEnv } from '@/lib/convene/env';

export const maxDuration = 30; // seconds — well above the sum of our per-call timeouts

interface GoogleUserInfo {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: 'Bearer';
}

function logStep(reqId: string, step: string, extra?: Record<string, unknown>) {
  // Single-line JSON so Vercel runtime logs are searchable.
  console.log(
    JSON.stringify({ at: 'convene/oauth/callback', req: reqId, step, ...extra })
  );
}

async function timedFetch(url: string, init: RequestInit, ms: number, label: string): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`${label} timed out after ${ms}ms`);
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

async function exchangeCodeForTokensVerbose(code: string, reqId: string): Promise<GoogleTokenResponse> {
  logStep(reqId, 'token_exchange_start');
  const body = new URLSearchParams({
    code,
    client_id: conveneEnv.googleClientId(),
    client_secret: conveneEnv.googleClientSecret(),
    redirect_uri: conveneEnv.googleRedirectUri(),
    grant_type: 'authorization_code',
  });
  const res = await timedFetch(
    'https://oauth2.googleapis.com/token',
    { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body },
    8000,
    'google token exchange'
  );
  logStep(reqId, 'token_exchange_response', { status: res.status });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google token exchange failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const parsed = (await res.json()) as GoogleTokenResponse;
  logStep(reqId, 'token_exchange_parsed', {
    has_refresh: !!parsed.refresh_token,
    expires_in: parsed.expires_in,
    scope_len: parsed.scope?.length ?? 0,
  });
  return parsed;
}

async function fetchUserInfoVerbose(accessToken: string, reqId: string): Promise<GoogleUserInfo> {
  logStep(reqId, 'userinfo_start');
  const res = await timedFetch(
    'https://openidconnect.googleapis.com/v1/userinfo',
    { headers: { authorization: `Bearer ${accessToken}` } },
    6000,
    'google userinfo'
  );
  logStep(reqId, 'userinfo_response', { status: res.status });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google userinfo failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return (await res.json()) as GoogleUserInfo;
}

export async function GET(req: NextRequest) {
  const reqId = Math.random().toString(36).slice(2, 10);
  logStep(reqId, 'enter', { url: req.nextUrl.pathname });

  if (!isConveneEnabled()) {
    logStep(reqId, 'convene_disabled');
    return NextResponse.json({ error: 'convene_disabled' }, { status: 404 });
  }

  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const errorParam = req.nextUrl.searchParams.get('error');
  logStep(reqId, 'params', { has_code: !!code, has_state: !!state, error: errorParam });

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

  logStep(reqId, 'state_lookup_start');
  // ownership-ok: state token is unguessable, single-use, user_id is the trusted source (KAN-206)
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
  if (stateRow.provider !== 'google') {
    return NextResponse.json({ error: 'state_provider_mismatch' }, { status: 400 });
  }

  await admin.from('oauth_connect_state').delete().eq('state', state);
  logStep(reqId, 'state_consumed');

  let tokens: GoogleTokenResponse;
  try {
    tokens = await exchangeCodeForTokensVerbose(code, reqId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    logStep(reqId, 'token_exchange_failed', { msg });
    return NextResponse.json({ error: 'token_exchange_failed', detail: msg }, { status: 502 });
  }

  if (!tokens.refresh_token) {
    logStep(reqId, 'no_refresh_token');
    return NextResponse.json(
      { error: 'no_refresh_token', hint: 'access_type=offline + prompt=consent required' },
      { status: 400 }
    );
  }

  let userInfo: GoogleUserInfo;
  try {
    userInfo = await fetchUserInfoVerbose(tokens.access_token, reqId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    logStep(reqId, 'userinfo_failed', { msg });
    return NextResponse.json({ error: 'userinfo_failed', detail: msg }, { status: 502 });
  }

  logStep(reqId, 'upsert_start', { sub: userInfo.sub });
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
    const msg = e instanceof Error ? e.message : 'unknown';
    logStep(reqId, 'upsert_failed', { msg });
    return NextResponse.json({ error: 'persist_failed', detail: msg }, { status: 500 });
  }
  logStep(reqId, 'upsert_done');

  // ownership-ok: writing audit for the verified state user (KAN-206)
  await admin.from('consent_log').insert({
    user_id: stateRow.user_id,
    event_type: 'oauth_granted',
    subject_kind: 'provider',
    subject_id: 'google',
    metadata: { scope: tokens.scope, account: userInfo.email ?? userInfo.sub },
  });
  logStep(reqId, 'consent_logged');

  logStep(reqId, 'redirect_to_dashboard');
  return NextResponse.redirect(
    new URL('/dashboard?convene_oauth=connected&provider=google', req.url)
  );
}
