/**
 * OAuth consent decisions — the grant/deny flow, lifted out of the app tree.
 * KAN-415 D7 part 3.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * This is the last of D7's ten closures, and it is a different shape from the
 * other eight. Those were unexported `'use server'` closures that could not be
 * imported at all. These two were already thin — `page.tsx` delegates to
 * `./actions` — so the problem was not reachability but LOCATION: the real
 * security logic sat in `src/app/oauth/authorize/actions.ts`, a `'use server'`
 * file inside the app tree, which constrains it in three ways that matter here.
 *
 * 1. A `'use server'` file may export ONLY async functions (gotcha #18), so
 *    `DecideInput` had to live in a separate type-only sibling that existed for
 *    no reason except that restriction. A plain module exports it directly, and
 *    that sibling file is now gone.
 * 2. The pure decisions inside — the open-redirect guard, the authorize-URL
 *    rebuild — could not be exported and therefore could not be tested as
 *    themselves. They were reachable only by driving a whole server action.
 * 3. Anything in `src/app/` is invisible to the module dependency rules. As a
 *    module this code is now covered by `no-module-to-app`, which is why the
 *    `./types` import had to go rather than merely move: importing it from
 *    here would be a BLOCKING violation.
 *
 * `actions.ts` remains as two thin `'use server'` wrappers, because the page's
 * `<form action={…}>` needs real server actions. Parsing a form is not the part
 * that needed testing; issuing an OAuth authorization code is.
 *
 * ⚠️ THE FROZEN CONTRACT: FAIL CLOSED ON ISSUANCE.
 * `submitConsent` re-validates the client, the redirect URI and PKCE on the
 * action side — a caller can POST here directly with a crafted payload, so
 * nothing from the form is trusted. SEC-57 then refuses issuance for any
 * standing that is not positively good, INCLUDING `'unknown'`. That asymmetry
 * is deliberate and is the security decision of the whole flow: the consent
 * PAGE fails open on `'unknown'` for availability, and this, the credential
 * mint, fails closed. Both halves are asserted, here and in
 * `tests/unit/oauth-authorize-suspension-guard.test.ts`.
 *
 * ⚠️ ORDER IS CONTRACT. Consent is recorded BEFORE the code is issued, so a
 * failure between them leaves a grant with no code rather than a code with no
 * audit trail of the user having agreed to it.
 */
import { redirect } from 'next/navigation';
import { createClient as createSupabaseServer } from '@/modules/platform/supabase-server';
import { getAccountStanding, shouldRefuseIssuance } from '@/lib/account-status';
import { issueAuthCode } from '@/modules/oauth-as/lib/codes';
import { recordConsent } from '@/modules/oauth-as/lib/consents';
import { getOauthClient } from '@/modules/oauth-as/lib/clients';
import { buildSuccessRedirect, buildErrorRedirect } from '@/modules/oauth-as/lib/authorize';

/**
 * The consent form's payload.
 *
 * Previously a `types.ts` sibling of the authorize action, which existed solely
 * because a `'use server'` file cannot export a type. It belongs with its
 * functions, and that file is now deleted.
 */
export interface DecideInput {
  client_id: string;
  redirect_uri: string;
  scope: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  decision: 'allow' | 'deny';
}

/** The parameters that must survive a round-trip through /login. */
export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  scope: string;
  state?: string;
  codeChallenge: string;
  codeChallengeMethod: string;
}

/**
 * Rebuild the `/oauth/authorize` path + query for a `?next=` round-trip.
 *
 * ⚠️ ONE implementation, previously two. The consent page built this to hand to
 * the Switch-account button, and the action built it again for the
 * session-expired bounce — same seven parameters, same order, from differently
 * named fields. The authorize URL is a **frozen contract** (modules.json lists
 * "URLs"), and two independent constructions of a frozen contract diverge
 * eventually; whichever one a fix missed would send the user back to a
 * subtly different request. Parameter ORDER is preserved exactly as both
 * copies emitted it, since the string is compared verbatim in tests and read
 * by external clients.
 */
export function buildAuthorizePath(params: AuthorizeParams): string {
  // The origin is a placeholder: only pathname + search is ever used, and
  // URLSearchParams gives correct encoding that manual concatenation does not.
  const url = new URL('/oauth/authorize', 'https://placeholder');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', params.scope);
  if (params.state) url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', params.codeChallengeMethod);
  return url.pathname + url.search;
}

/**
 * Open-redirect guard for the post-login `next` target.
 *
 * The caller passes the authorize path it is currently rendering, but this
 * value reaches a `?next=` that the login page will follow, so it is treated as
 * untrusted. Only a relative `/oauth/authorize?…` is accepted; everything else
 * falls back to `/login`. An absolute URL, a protocol-relative `//evil.test`
 * and a path that merely CONTAINS the prefix are all rejected by the same
 * `startsWith` — which is why the check is anchored rather than a substring
 * match.
 */
export function safeAuthorizeNext(authorizePathWithQuery: string): string {
  return authorizePathWithQuery.startsWith('/oauth/authorize?') ? authorizePathWithQuery : '/login';
}

/**
 * Switch the signed-in account for a pending OAuth consent — KAN-88 follow-up
 * (2026-05-18 account mix-up: a user with several accounts granted access from
 * the wrong one).
 *
 * Signs out and bounces to /login with the authorize URL preserved, so the user
 * returns to the same prompt as the right account.
 *
 * ⚠️ This function is on the qa-sweep destructive denylist — it calls
 * `auth.signOut()`, and an automated click-everything run that presses "Switch
 * account" turns the rest of the run into a tour of the login page. The
 * denylist is keyed `file::function`, so MOVING this function moves its key;
 * `tests/scripts/qa-sweep-preflight.test.js` derives the required set from
 * source and fails until `qa-sweep/config.py` lists the new location.
 */
export async function switchAccountAndContinue(authorizePathWithQuery: string): Promise<void> {
  const sb = await createSupabaseServer();
  await sb.auth.signOut();
  const safeNext = safeAuthorizeNext(authorizePathWithQuery);
  redirect(`/login?next=${encodeURIComponent(safeNext)}`);
}

/**
 * Record the user's Allow/Deny decision and complete the authorization request.
 *
 * Allow → record consent, issue an auth code, redirect to the client with
 * `?code=…&state=…`. Deny → redirect with `?error=access_denied&state=…`.
 */
export async function submitConsent(input: DecideInput): Promise<void> {
  // Re-validate the client + redirect URI here, not just on the page. A
  // malicious caller can POST straight to the action with crafted params, so
  // the form payload is not evidence of anything.
  const client = await getOauthClient(input.client_id);
  if (!client || client.revoked_at) {
    redirect('/oauth/error?reason=invalid_client');
  }
  if (!client!.redirect_uris.includes(input.redirect_uri)) {
    redirect('/oauth/error?reason=invalid_redirect_uri');
  }
  if (input.code_challenge_method !== 'S256' || !input.code_challenge) {
    redirect(
      buildErrorRedirect(
        input.redirect_uri,
        'invalid_request',
        'pkce required',
        input.state || undefined
      )
    );
  }

  const sb = await createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    // Session expired between page render and form submit. Bounce back to
    // login, preserving the original authorize request.
    redirect(
      `/login?next=${encodeURIComponent(
        buildAuthorizePath({
          clientId: input.client_id,
          redirectUri: input.redirect_uri,
          scope: input.scope,
          state: input.state,
          codeChallenge: input.code_challenge,
          codeChallengeMethod: input.code_challenge_method,
        })
      )}`
    );
  }

  const state = input.state || undefined;

  if (input.decision === 'deny') {
    redirect(
      buildErrorRedirect(input.redirect_uri, 'access_denied', 'user denied authorization', state)
    );
  }

  // SEC-57: refuse to mint a credential for a suspended — or unverifiable —
  // account. Fails closed, so a suspended user cannot complete a grant even by
  // POSTing here directly. They go to the in-app suspended page rather than
  // back to the client with a code.
  const standing = await getAccountStanding(sb, user!.id);
  if (shouldRefuseIssuance(standing)) {
    redirect('/suspended');
  }

  // Allow path — consent first, then the code (see the header: a code with no
  // recorded consent is the ordering we must never produce).
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
