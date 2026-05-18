/**
 * /oauth/authorize — KAN-88 P3 consent screen.
 *
 * Entry point of the OAuth Authorization Code + PKCE flow. Validates
 * the inbound request, requires the user to be signed in, and shows
 * the consent screen so they can Allow or Deny the request.
 *
 * Auto-skips the consent screen if the user has previously consented
 * to this client and the requested scopes match the previous grant.
 */

import { redirect } from 'next/navigation';
import { createClient as createSupabaseServer } from '@/lib/supabase-server';
import { validateAuthorizeRequest, buildErrorRedirect } from '@/lib/oauth/authorize';
import { getConsent } from '@/lib/oauth/consents';
import { submitConsent, switchAccountAndContinue } from './actions';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Authorize access — Lyra',
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AuthorizePage({ searchParams }: PageProps) {
  const params = await searchParams;

  // Coerce searchParams shape — Next gives us strings or arrays.
  const pick = (k: string): string | undefined => {
    const v = params[k];
    if (Array.isArray(v)) return v[0];
    return v;
  };

  const validation = await validateAuthorizeRequest({
    response_type: pick('response_type'),
    client_id: pick('client_id'),
    redirect_uri: pick('redirect_uri'),
    scope: pick('scope'),
    state: pick('state'),
    code_challenge: pick('code_challenge'),
    code_challenge_method: pick('code_challenge_method'),
  });

  if (!validation.ok) {
    if (validation.error.kind === 'fatal') {
      // Cannot trust the redirect URI — render an in-page error.
      return <FatalError code={validation.error.code} description={validation.error.description} />;
    }
    // Protocol error — redirect back to the client with ?error=…
    redirect(
      buildErrorRedirect(
        validation.error.redirectUri,
        validation.error.code,
        validation.error.description,
        validation.error.state
      )
    );
  }

  const req = validation.req;

  // Require a signed-in user. If not, send to /login with `next` so they
  // come back here after authenticating.
  const sb = await createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) {
    const next = new URL('/oauth/authorize', 'https://placeholder');
    next.searchParams.set('client_id', req.client.client_id);
    next.searchParams.set('redirect_uri', req.redirectUri);
    next.searchParams.set('response_type', 'code');
    next.searchParams.set('scope', req.scope);
    if (req.state) next.searchParams.set('state', req.state);
    next.searchParams.set('code_challenge', req.codeChallenge);
    next.searchParams.set('code_challenge_method', req.codeChallengeMethod);
    redirect(`/login?next=${encodeURIComponent(next.pathname + next.search)}`);
  }

  // Auto-skip consent if user has already granted the same (or wider)
  // scopes to this client. Reconsent only fires for new scopes.
  // Note: we intentionally show the consent screen on every authorize
  // request, even when a prior grant exists for this client. claude.ai's
  // MCP OAuth client (as of 2026-05-17) does not exchange auth codes that
  // arrive via the auto-skip-consent fast-path — the popup receives the
  // 307 to `redirect_uri?code=…&state=…` but its callback handler never
  // POSTs to /oauth/token. Showing the consent screen every time keeps
  // the flow within the spec-standard interaction shape every client
  // tests against. (Standard OAuth flows always re-show consent unless
  // the client explicitly sends prompt=none.)
  //
  // We still write/update the consent row when the user clicks Allow —
  // it's the audit trail of when they granted access, not a fast-path
  // optimisation.
  const _priorConsent = await getConsent(user!.id, req.client.client_id);
  void _priorConsent; // referenced for the audit-table read; surfaced
                     // to the consent screen UI in a follow-up so users
                     // can see "previously granted on …".

  // Build the exact authorize URL we're currently rendering, so that the
  // "switch account" link can preserve the OAuth state through a re-login.
  const currentAuthorizeUrl = new URL('/oauth/authorize', 'https://placeholder');
  currentAuthorizeUrl.searchParams.set('client_id', req.client.client_id);
  currentAuthorizeUrl.searchParams.set('redirect_uri', req.redirectUri);
  currentAuthorizeUrl.searchParams.set('response_type', 'code');
  currentAuthorizeUrl.searchParams.set('scope', req.scope);
  if (req.state) currentAuthorizeUrl.searchParams.set('state', req.state);
  currentAuthorizeUrl.searchParams.set('code_challenge', req.codeChallenge);
  currentAuthorizeUrl.searchParams.set('code_challenge_method', req.codeChallengeMethod);
  const authorizePathWithQuery = currentAuthorizeUrl.pathname + currentAuthorizeUrl.search;

  // Show the consent screen.
  return (
    <main style={{ maxWidth: 560, margin: '64px auto', padding: '0 24px', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Authorize access</h1>
      <p style={{ color: '#555' }}>
        <strong>{req.client.client_name}</strong> wants access to your Lyra account.
      </p>

      {/*
        Prominent account banner (KAN-88 follow-up, 2026-05-18). Earlier
        we displayed "Signed in as …" in dim grey at #777, which a real
        user missed and ended up granting Claude access to the wrong
        account. Now: a yellow-background banner with bold email + an
        in-line server-action button that signs out + bounces back to the
        login screen, preserving this authorize URL through the round-trip.
      */}
      <div
        style={{
          background: '#fef9e7',
          border: '1px solid #f0d97d',
          padding: 16,
          borderRadius: 8,
          margin: '24px 0',
        }}
      >
        <p style={{ margin: 0 }}>
          You will be granting access as{' '}
          <strong style={{ fontSize: 16 }}>{user!.email}</strong>.
        </p>
        <p style={{ margin: '8px 0 0', fontSize: 13, color: '#666' }}>
          If this isn&apos;t the right account, switch before clicking Allow.
        </p>
        <form
          action={async () => {
            'use server';
            await switchAccountAndContinue(authorizePathWithQuery);
          }}
          style={{ marginTop: 12 }}
        >
          <button
            type="submit"
            style={{
              background: 'transparent',
              border: '1px solid #c79b1b',
              color: '#5a4310',
              padding: '6px 14px',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            Switch account
          </button>
        </form>
      </div>

      <div style={{ background: '#f5f4ef', padding: 16, borderRadius: 8, margin: '24px 0' }}>
        <p style={{ margin: 0, fontWeight: 600 }}>This will let it:</p>
        <ul style={{ marginTop: 8, marginBottom: 0 }}>
          {req.scope.split(/\s+/).map((s) => (
            <li key={s}>{scopeDescription(s)}</li>
          ))}
        </ul>
      </div>

      <p style={{ fontSize: 14, color: '#777' }}>
        You can revoke this access anytime from your Lyra settings.
      </p>

      <form
        action={async (formData: FormData) => {
          'use server';
          const decision = formData.get('decision') === 'allow' ? 'allow' : 'deny';
          await submitConsent({
            client_id: req.client.client_id,
            redirect_uri: req.redirectUri,
            scope: req.scope,
            state: req.state ?? '',
            code_challenge: req.codeChallenge,
            code_challenge_method: req.codeChallengeMethod,
            decision,
          });
        }}
        style={{ display: 'flex', gap: 12, marginTop: 24 }}
      >
        <button
          type="submit"
          name="decision"
          value="deny"
          style={{
            background: '#fff',
            border: '1px solid #ccc',
            padding: '10px 20px',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          Deny
        </button>
        <button
          type="submit"
          name="decision"
          value="allow"
          style={{
            background: '#6b8e6f',
            color: '#fff',
            border: 'none',
            padding: '10px 20px',
            borderRadius: 8,
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Allow
        </button>
      </form>
    </main>
  );
}

function scopeDescription(scope: string): string {
  switch (scope) {
    case 'lyra:full':
      return 'Read and edit your Lyra profile, gatherings, contacts, and calendar connections';
    default:
      return scope;
  }
}

function FatalError({ code, description }: { code: string; description: string }) {
  return (
    <main style={{ maxWidth: 560, margin: '96px auto', padding: '0 24px', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Authorization request rejected</h1>
      <p style={{ color: '#a32' }}>
        <strong>Error:</strong> {code}
      </p>
      <p style={{ color: '#555' }}>{description}</p>
      <p style={{ color: '#888', fontSize: 14, marginTop: 32 }}>
        This usually means the app sending you here misconfigured its OAuth client. There&apos;s
        nothing wrong with your Lyra account — just close this tab.
      </p>
    </main>
  );
}
