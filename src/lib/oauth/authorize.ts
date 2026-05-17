/**
 * /oauth/authorize request validation — KAN-88 P3.
 *
 * Splits errors into two categories per OAuth 2.1 §4.1.2.1:
 *
 *   FATAL (display error page directly, never redirect):
 *     - invalid/unknown client_id
 *     - invalid/unregistered redirect_uri
 *   These errors must NOT redirect because we cannot trust the
 *   redirect_uri the client supplied.
 *
 *   REDIRECT (return to client's redirect_uri with ?error=…):
 *     - unsupported_response_type
 *     - invalid_request (missing PKCE, wrong method, etc.)
 *     - invalid_scope
 *     - access_denied (user clicked Deny)
 */

import { getOauthClient, type ClientRecord } from './clients';

export interface AuthorizeRequest {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
}

export type AuthorizeError =
  | {
      kind: 'fatal';
      // Show on the in-page error screen — no redirect.
      code: 'invalid_client' | 'invalid_redirect_uri';
      description: string;
    }
  | {
      kind: 'redirect';
      // Return to the client's redirect_uri with these query params.
      redirectUri: string;
      state: string | undefined;
      code: 'invalid_request' | 'unsupported_response_type' | 'invalid_scope' | 'access_denied' | 'server_error';
      description: string;
    };

export interface ValidatedAuthorizeRequest {
  client: ClientRecord;
  redirectUri: string;
  scope: string;
  state: string | undefined;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
}

export async function validateAuthorizeRequest(
  raw: AuthorizeRequest
): Promise<{ ok: true; req: ValidatedAuthorizeRequest } | { ok: false; error: AuthorizeError }> {
  // 1. client_id — fatal if missing/unknown.
  if (!raw.client_id || typeof raw.client_id !== 'string') {
    return { ok: false, error: { kind: 'fatal', code: 'invalid_client', description: 'client_id is required' } };
  }
  const client = await getOauthClient(raw.client_id);
  if (!client) {
    return { ok: false, error: { kind: 'fatal', code: 'invalid_client', description: 'unknown client_id' } };
  }
  if (client.revoked_at) {
    return { ok: false, error: { kind: 'fatal', code: 'invalid_client', description: 'client revoked' } };
  }

  // 2. redirect_uri — fatal if missing/unregistered.
  // Exact match (no scheme/host/path normalisation per OAuth 2.1).
  if (!raw.redirect_uri || typeof raw.redirect_uri !== 'string') {
    return {
      ok: false,
      error: { kind: 'fatal', code: 'invalid_redirect_uri', description: 'redirect_uri is required' },
    };
  }
  if (!client.redirect_uris.includes(raw.redirect_uri)) {
    return {
      ok: false,
      error: { kind: 'fatal', code: 'invalid_redirect_uri', description: 'redirect_uri not registered for this client' },
    };
  }

  // From here on, errors can redirect back to the (now-validated) URI.
  const state = typeof raw.state === 'string' ? raw.state : undefined;
  const redirectUri = raw.redirect_uri;

  // 3. response_type — must be 'code'.
  if (raw.response_type !== 'code') {
    return {
      ok: false,
      error: {
        kind: 'redirect',
        redirectUri,
        state,
        code: 'unsupported_response_type',
        description: 'response_type must be "code"',
      },
    };
  }

  // 4. PKCE — required in OAuth 2.1.
  if (!raw.code_challenge || typeof raw.code_challenge !== 'string') {
    return {
      ok: false,
      error: { kind: 'redirect', redirectUri, state, code: 'invalid_request', description: 'code_challenge is required' },
    };
  }
  if (raw.code_challenge_method !== 'S256') {
    return {
      ok: false,
      error: {
        kind: 'redirect',
        redirectUri,
        state,
        code: 'invalid_request',
        description: 'code_challenge_method must be "S256"',
      },
    };
  }

  // 5. Scope — default to client's allowed scope if not provided.
  const requested = typeof raw.scope === 'string' && raw.scope.length > 0 ? raw.scope : client.scopes;
  // For MVP we only accept lyra:full. Any other scope is invalid_scope.
  const requestedScopes = requested.split(/\s+/).filter(Boolean);
  for (const s of requestedScopes) {
    if (s !== 'lyra:full') {
      return {
        ok: false,
        error: {
          kind: 'redirect',
          redirectUri,
          state,
          code: 'invalid_scope',
          description: `unknown scope: ${s.slice(0, 80)}`,
        },
      };
    }
  }

  return {
    ok: true,
    req: {
      client,
      redirectUri,
      scope: requested,
      state,
      codeChallenge: raw.code_challenge,
      codeChallengeMethod: 'S256',
    },
  };
}

/**
 * Build a redirect URL back to the client with error params.
 * Used both for protocol-level errors and user-denies.
 */
export function buildErrorRedirect(
  redirectUri: string,
  code: string,
  description: string,
  state: string | undefined
): string {
  const url = new URL(redirectUri);
  url.searchParams.set('error', code);
  url.searchParams.set('error_description', description);
  if (state) url.searchParams.set('state', state);
  return url.toString();
}

/**
 * Build a redirect URL back to the client with the successful auth code.
 */
export function buildSuccessRedirect(redirectUri: string, code: string, state: string | undefined): string {
  const url = new URL(redirectUri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);
  return url.toString();
}
