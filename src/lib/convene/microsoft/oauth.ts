/**
 * Microsoft Graph OAuth 2.0 helpers — KAN-211 P7.
 *
 * Mirrors src/lib/convene/google/oauth.ts shape. Uses the v2.0 endpoints
 * on /common (multi-tenant + personal accounts).
 *
 * No npm dependency on @microsoft/microsoft-graph-client — we use fetch
 * directly to keep the surface small and auditable.
 */

import { conveneEnv } from '../env';

export const MICROSOFT_SCOPES = [
  'offline_access',
  'User.Read',
  'Calendars.ReadWrite',
] as const;

const AUTHORIZE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

export interface MicrosoftTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: 'Bearer';
  id_token?: string;
}

export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: conveneEnv.microsoftClientId(),
    redirect_uri: conveneEnv.microsoftRedirectUri(),
    response_type: 'code',
    response_mode: 'query',
    scope: MICROSOFT_SCOPES.join(' '),
    state,
    prompt: 'consent',
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

async function postToken(form: URLSearchParams): Promise<MicrosoftTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Microsoft token endpoint ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as MicrosoftTokenResponse;
}

export async function exchangeCodeForTokens(code: string): Promise<MicrosoftTokenResponse> {
  return postToken(
    new URLSearchParams({
      client_id: conveneEnv.microsoftClientId(),
      client_secret: conveneEnv.microsoftClientSecret(),
      code,
      redirect_uri: conveneEnv.microsoftRedirectUri(),
      grant_type: 'authorization_code',
    })
  );
}

export async function refreshAccessToken(refreshToken: string): Promise<MicrosoftTokenResponse> {
  return postToken(
    new URLSearchParams({
      client_id: conveneEnv.microsoftClientId(),
      client_secret: conveneEnv.microsoftClientSecret(),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: MICROSOFT_SCOPES.join(' '),
    })
  );
}

/**
 * Fetch the basic Microsoft Graph /me profile so we can resolve a
 * `providerAccountId` to store on the oauth_connections row.
 */
export async function fetchUserInfo(
  accessToken: string
): Promise<{ id: string; userPrincipalName?: string; mail?: string; displayName?: string }> {
  const res = await fetch('https://graph.microsoft.com/v1.0/me', {
    method: 'GET',
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(6_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Microsoft /me failed ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as {
    id: string;
    userPrincipalName?: string;
    mail?: string;
    displayName?: string;
  };
}
