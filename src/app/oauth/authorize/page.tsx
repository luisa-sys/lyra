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
import { validateAuthorizeRequest, buildErrorRedirect, buildSuccessRedirect } from '@/lib/oauth/authorize';
import { issueAuthCode } from '@/lib/oauth/codes';
import { getConsent, recordConsent } from '@/lib/oauth/consents';
import { submitConsent } from './actions';
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
  const existing = await getConsent(user!.id, req.client.client_id);
  if (existing && !existing.revoked_at && existing.scopes === req.scope) {
    // Touch the consent (refresh granted_at) and issue the code.
    await recordConsent(user!.id, req.client.client_id, req.scope);
    const { code } = await issueAuthCode({
      clientId: req.client.client_id,
      userId: user!.id,
      redirectUri: req.redirectUri,
      scope: req.scope,
      codeChallenge: req.codeChallenge,
      codeChallengeMethod: 'S256',
    });
    redirect(buildSuccessRedirect(req.redirectUri, code, req.state));
  }

  // Otherwise — show the consent screen.
  return (
    <main style={{ maxWidth: 560, margin: '64px auto', padding: '0 24px', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Authorize access</h1>
      <p style={{ color: '#555' }}>
        <strong>{req.client.client_name}</strong> wants access to your Lyra account.
      </p>

      <div style={{ background: '#f5f4ef', padding: 16, borderRadius: 8, margin: '24px 0' }}>
        <p style={{ margin: 0, fontWeight: 600 }}>This will let it:</p>
        <ul style={{ marginTop: 8, marginBottom: 0 }}>
          {req.scope.split(/\s+/).map((s) => (
            <li key={s}>{scopeDescription(s)}</li>
          ))}
        </ul>
      </div>

      <p style={{ fontSize: 14, color: '#777' }}>
        Signed in as <strong>{user!.email}</strong>. You can revoke this access anytime from your
        Lyra settings.
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
        This usually means the app sending you here misconfigured its OAuth client. There's nothing
        wrong with your Lyra account — just close this tab.
      </p>
    </main>
  );
}
