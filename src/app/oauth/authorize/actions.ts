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
