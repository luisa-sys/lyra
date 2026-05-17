/**
 * POST /oauth/revoke — RFC 7009 token revocation.
 *
 * Accepts:
 *   token=<refresh_token or JWT>
 *   token_type_hint=<refresh_token | access_token>  (optional)
 *   client_id=<client_id>
 *
 * Behaviour:
 *   - Refresh token → marks used_at AND revokes the whole family
 *     (so already-issued access tokens in the family lose validity
 *     when OAUTH_REVOCATION_CHECK=1 is enabled on the RS).
 *   - Access token (JWT) → decodes the jti, marks oauth_access_tokens
 *     row revoked.
 *
 * Per RFC 7009 §2.2: the endpoint always returns 200 even for unknown
 * tokens — disclosing whether a token exists or not is itself an
 * information leak. We log invalid attempts internally but never tell
 * the client.
 */

import { NextRequest, NextResponse } from 'next/server';
import { decodeJwt } from 'jose';
import { getRefreshToken, revokeFamily } from '@/lib/oauth/refresh';
import { revokeAccessTokenJti, getAccessTokenJti } from '@/lib/oauth/access-tokens';

interface RevokeRequest {
  token?: string;
  token_type_hint?: string;
  client_id?: string;
}

async function readBody(req: NextRequest): Promise<RevokeRequest | null> {
  const ct = req.headers.get('content-type') ?? '';
  try {
    if (ct.includes('application/x-www-form-urlencoded')) {
      const text = await req.text();
      const p = new URLSearchParams(text);
      return {
        token: p.get('token') ?? undefined,
        token_type_hint: p.get('token_type_hint') ?? undefined,
        client_id: p.get('client_id') ?? undefined,
      };
    }
    if (ct.includes('application/json')) {
      return (await req.json()) as RevokeRequest;
    }
  } catch {
    return null;
  }
  return null;
}

function okEmpty() {
  // RFC 7009 §2.2 — always 200 with no body on success or unknown token.
  return new NextResponse(null, {
    status: 200,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  });
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  // Per RFC 7009, an unparseable request is an error. But we still avoid
  // leaking — return 400 invalid_request only when shape is wrong, not
  // when the token itself is unknown.
  if (!body || !body.token || typeof body.token !== 'string') {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'token is required' },
      { status: 400, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } }
    );
  }

  const hint = body.token_type_hint;
  const token = body.token;

  // Try the hinted type first.
  if (hint === 'refresh_token' || hint === undefined) {
    if (await tryRevokeRefresh(token, body.client_id)) return okEmpty();
  }
  if (hint === 'access_token' || hint === undefined) {
    if (await tryRevokeAccess(token, body.client_id)) return okEmpty();
  }
  // Fallback — try the other type if hint was wrong.
  if (hint === 'refresh_token') {
    if (await tryRevokeAccess(token, body.client_id)) return okEmpty();
  }
  if (hint === 'access_token') {
    if (await tryRevokeRefresh(token, body.client_id)) return okEmpty();
  }
  // Unknown token — return 200 anyway (RFC 7009 §2.2).
  return okEmpty();
}

async function tryRevokeRefresh(token: string, clientIdHint: string | undefined): Promise<boolean> {
  // Refresh tokens have the lyra_refresh_ prefix.
  if (!token.startsWith('lyra_refresh_')) return false;
  const row = await getRefreshToken(token);
  if (!row) return false;
  if (clientIdHint && row.client_id !== clientIdHint) {
    // Token exists but belongs to a different client — silently refuse.
    return true;
  }
  await revokeFamily(row.family_id);
  return true;
}

async function tryRevokeAccess(token: string, clientIdHint: string | undefined): Promise<boolean> {
  // Access tokens are JWTs.
  let jti: string;
  try {
    const claims = decodeJwt(token);
    if (typeof claims.jti !== 'string') return false;
    jti = claims.jti;
    if (clientIdHint && typeof claims.client_id === 'string' && claims.client_id !== clientIdHint) {
      return true;
    }
  } catch {
    return false;
  }
  const existing = await getAccessTokenJti(jti);
  if (!existing) return false;
  await revokeAccessTokenJti(jti);
  return true;
}
