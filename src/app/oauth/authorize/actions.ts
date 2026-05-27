'use server';

/**
 * /oauth/authorize server actions — KAN-88 P3.
 *
 * Server actions invoked from the consent screen's <form>. Only async
 * functions can be exported from a 'use server' file (BUGS-12 gotcha
 * from CLAUDE.md).
 *
 * The action does the final issue-and-redirect step after the user
 * clicks Allow or Deny:
 *   - Allow → record consent (if not already), issue auth code,
 *     redirect to client redirect_uri with ?code=…&state=…
 *   - Deny  → redirect with ?error=access_denied&state=…
 */

import { redirect } from 'next/navigation';
import { createClient as createSupabaseServer } from '@/lib/supabase-server';
import { issueAuthCode } from '@/lib/oauth/codes';
import { recordConsent } from '@/lib/oauth/consents';
import { getOauthClient } from '@/lib/oauth/clients';
import { buildSuccessRedirect, buildErrorRedirect } from '@/lib/oauth/authorize';
import type { DecideInput } from './types';

/**
 * Switch the signed-in account for a pending OAuth consent — KAN-88
 * follow-up (2026-05-18 ben/luisa account mix-up).
 *
 * Sign out the current Supabase session and bounce the user to /login
 * with the full /oauth/authorize URL preserved in ?next=… so they
 * return to the same authorize prompt once signed in as the right
 * account.
 */
export async function switchAccountAndContinue(authorizePathWithQuery: string): Promise<void> {
  const sb = await createSupabaseServer();
  await sb.auth.signOut();
  // The caller passes the exact authorize path + query that they're
  // currently on. We only use it as the post-login `next` target.
  // Guard against open-redirect: only accept a relative path that starts
  // with /oauth/authorize? — anything else falls back to /login.
  const safeNext =
    authorizePathWithQuery.startsWith('/oauth/authorize?') ? authorizePathWithQuery : '/login';
  redirect(`/login?next=${encodeURIComponent(safeNext)}`);
}

export async function submitConsent(input: DecideInput): Promise<void> {
  // Re-validate the client + redirect URI on the action side. A
  // malicious caller might POST directly to the action with crafted
  // params — we cannot trust the form payload.
  const client = await getOauthClient(input.client_id);
  if (!client || client.revoked_at) {
    redirect('/oauth/error?reason=invalid_client');
  }
  if (!client!.redirect_uris.includes(input.redirect_uri)) {
    redirect('/oauth/error?reason=invalid_redirect_uri');
  }
  if (input.code_challenge_method !== 'S256' || !input.code_challenge) {
    redirect(buildErrorRedirect(input.redirect_uri, 'invalid_request', 'pkce required', input.state || undefined));
  }

  const sb = await createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    // Session expired between page render and form submit. Bounce
    // back to login; preserve the original authorize URL.
    const next = new URL('/oauth/authorize', 'https://placeholder');
    next.searchParams.set('client_id', input.client_id);
    next.searchParams.set('redirect_uri', input.redirect_uri);
    next.searchParams.set('response_type', 'code');
    next.searchParams.set('scope', input.scope);
    if (input.state) next.searchParams.set('state', input.state);
    next.searchParams.set('code_challenge', input.code_challenge);
    next.searchParams.set('code_challenge_method', input.code_challenge_method);
    redirect(`/login?next=${encodeURIComponent(next.pathname + next.search)}`);
  }

  const state = input.state || undefined;

  if (input.decision === 'deny') {
    redirect(buildErrorRedirect(input.redirect_uri, 'access_denied', 'user denied authorization', state));
  }

  // Allow path — record consent + issue code + redirect.
  await recordConsent(user!.id, input.client_id, input.scope);
  const { code } = await issueAuthCode({
    clientId: input.client_id,
    userId: user!.id,
    redirectUri: input.redirect_uri,
    scope: input.scope,
    codeChallenge: input.code_challenge,
    codeChallengeMethod: 'S256',
  });

  redirect(buildSuccessRedirect(input.redirect_uri, code, state));
}
