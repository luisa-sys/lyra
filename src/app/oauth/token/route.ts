/**
 * POST /oauth/token — Token endpoint (RFC 6749 §4.1.3 + §6).
 *
 * Two grant types:
 *
 *   1. authorization_code — exchange a one-time auth code (from
 *      /oauth/authorize) for an access token + refresh token.
 *      Required params: grant_type, code, redirect_uri, client_id,
 *      code_verifier (PKCE).
 *
 *   2. refresh_token — rotate a refresh token to get a new access
 *      token + new refresh token. Required: grant_type, refresh_token,
 *      client_id.
 *
 * Public clients (token_endpoint_auth_method=none) authenticate
 * implicitly by demonstrating possession of the auth code's
 * code_verifier (PKCE) or the refresh token. Confidential clients
 * (client_secret_basic / _post) additionally include client_secret —
 * we don't issue those in MVP but the code handles them gracefully.
 *
 * Response is application/json (RFC 6749 §5.1) with no-store cache.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOauthClient, hashClientSecret } from '@/lib/oauth/clients';
import { getAuthCode, markCodeUsed } from '@/lib/oauth/codes';
import { verifyPkceS256 } from '@/lib/oauth/pkce';
import { issueAccessToken } from '@/lib/oauth/jwt';
import { issueAccessTokenJti } from '@/lib/oauth/access-tokens';
import {
  issueRefreshToken,
  tryMarkRefreshUsed,
  getRefreshToken,
  revokeFamily,
} from '@/lib/oauth/refresh';
import { oauthConfig } from '@/lib/oauth/config';

function errorJson(error: string, description?: string, status = 400) {
  return NextResponse.json(
    { error, ...(description ? { error_description: description } : {}) },
    {
      status,
      headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
    }
  );
}

function successJson(body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status: 200,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  });
}

interface TokenRequest {
  grant_type?: string;
  code?: string;
  redirect_uri?: string;
  client_id?: string;
  client_secret?: string;
  code_verifier?: string;
  refresh_token?: string;
}

async function readTokenRequest(req: NextRequest): Promise<TokenRequest | null> {
  const ct = req.headers.get('content-type') ?? '';
  try {
    if (ct.includes('application/x-www-form-urlencoded')) {
      const text = await req.text();
      const params = new URLSearchParams(text);
      const out: TokenRequest = {};
      for (const k of [
        'grant_type',
        'code',
        'redirect_uri',
        'client_id',
        'client_secret',
        'code_verifier',
        'refresh_token',
      ] as const) {
        const v = params.get(k);
        if (v !== null) out[k] = v;
      }
      return out;
    }
    if (ct.includes('application/json')) {
      return (await req.json()) as TokenRequest;
    }
  } catch {
    return null;
  }
  return null;
}

async function authenticateClient(
  req: NextRequest,
  body: TokenRequest
): Promise<
  | { ok: true; clientId: string }
  | { ok: false; status: number; error: string; description: string }
> {
  // RFC 6749 supports client_id+secret in Basic auth header OR in body.
  let clientId = body.client_id;
  let clientSecret = body.client_secret;

  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
      const [u, p] = decoded.split(':');
      if (u) clientId = u;
      if (p) clientSecret = p;
    } catch {
      return { ok: false, status: 401, error: 'invalid_client', description: 'malformed Authorization' };
    }
  }

  if (!clientId) {
    return { ok: false, status: 400, error: 'invalid_request', description: 'client_id is required' };
  }

  const client = await getOauthClient(clientId);
  if (!client || client.revoked_at) {
    return { ok: false, status: 401, error: 'invalid_client', description: 'unknown or revoked client' };
  }

  if (client.token_endpoint_auth_method === 'none') {
    // Public client. PKCE protects the code; no secret required.
    return { ok: true, clientId };
  }

  // Confidential client — secret required.
  if (!clientSecret || !client.client_secret_hash) {
    return { ok: false, status: 401, error: 'invalid_client', description: 'client authentication failed' };
  }
  // Timing-safe-ish compare via sha256 round-trip.
  if (hashClientSecret(clientSecret) !== client.client_secret_hash) {
    return { ok: false, status: 401, error: 'invalid_client', description: 'client authentication failed' };
  }
  return { ok: true, clientId };
}

export async function POST(req: NextRequest) {
  const body = await readTokenRequest(req);
  if (!body) return errorJson('invalid_request', 'body must be form-encoded or JSON');

  const auth = await authenticateClient(req, body);
  if (!auth.ok) return errorJson(auth.error, auth.description, auth.status);

  const grantType = body.grant_type;
  if (grantType === 'authorization_code') {
    return handleAuthorizationCode(body, auth.clientId);
  }
  if (grantType === 'refresh_token') {
    return handleRefresh(body, auth.clientId);
  }
  return errorJson('unsupported_grant_type', `grant_type=${grantType ?? '<missing>'} is not supported`);
}

async function handleAuthorizationCode(body: TokenRequest, clientId: string): Promise<NextResponse> {
  if (!body.code) return errorJson('invalid_request', 'code is required');
  if (!body.redirect_uri) return errorJson('invalid_request', 'redirect_uri is required');
  if (!body.code_verifier) return errorJson('invalid_request', 'code_verifier is required (PKCE)');

  const codeRow = await getAuthCode(body.code);
  if (!codeRow) return errorJson('invalid_grant', 'unknown code', 400);
  if (codeRow.used_at) return errorJson('invalid_grant', 'code already used', 400);
  if (new Date(codeRow.expires_at).getTime() < Date.now()) {
    return errorJson('invalid_grant', 'code expired', 400);
  }
  if (codeRow.client_id !== clientId) {
    return errorJson('invalid_grant', 'code was issued to a different client', 400);
  }
  if (codeRow.redirect_uri !== body.redirect_uri) {
    return errorJson('invalid_grant', 'redirect_uri does not match the authorization request', 400);
  }
  if (codeRow.code_challenge_method !== 'S256') {
    return errorJson('invalid_grant', 'code was not bound to a PKCE challenge', 400);
  }
  if (!verifyPkceS256(body.code_verifier, codeRow.code_challenge)) {
    return errorJson('invalid_grant', 'PKCE verification failed', 400);
  }

  // Mark code used — atomically wins or returns null on race.
  const claimed = await markCodeUsed(body.code);
  if (!claimed) return errorJson('invalid_grant', 'code already used (race)', 400);

  // Issue access token (JWT) + refresh token.
  const access = await issueAccessToken({
    userId: codeRow.user_id,
    clientId,
    scope: codeRow.scope,
  });
  await issueAccessTokenJti({
    jti: access.jti,
    clientId,
    userId: codeRow.user_id,
    scope: codeRow.scope,
    expiresAt: access.expiresAt,
  });
  const refresh = await issueRefreshToken({
    clientId,
    userId: codeRow.user_id,
    scope: codeRow.scope,
  });

  return successJson({
    access_token: access.jwt,
    token_type: 'Bearer',
    expires_in: oauthConfig.accessTokenTtlSeconds,
    refresh_token: refresh.token,
    scope: codeRow.scope,
  });
}

async function handleRefresh(body: TokenRequest, clientId: string): Promise<NextResponse> {
  if (!body.refresh_token) return errorJson('invalid_request', 'refresh_token is required');

  // Look up first so we can identify the family if compromised.
  const existing = await getRefreshToken(body.refresh_token);
  if (!existing) return errorJson('invalid_grant', 'unknown refresh token', 400);
  if (existing.client_id !== clientId) {
    return errorJson('invalid_grant', 'refresh token belongs to a different client', 400);
  }
  if (new Date(existing.expires_at).getTime() < Date.now()) {
    return errorJson('invalid_grant', 'refresh token expired', 400);
  }
  if (existing.used_at) {
    // Refresh token reuse — compromise! Revoke entire family.
    await revokeFamily(existing.family_id);
    return errorJson('invalid_grant', 'refresh token replay detected — family revoked', 400);
  }

  // Try to mark it used (race-safe).
  const claimed = await tryMarkRefreshUsed(body.refresh_token);
  if (!claimed) {
    // Lost a race — same effect as replay.
    await revokeFamily(existing.family_id);
    return errorJson('invalid_grant', 'refresh token already used (race)', 400);
  }

  // Issue new tokens, continuing the family.
  const access = await issueAccessToken({
    userId: existing.user_id,
    clientId,
    scope: existing.scope,
  });
  await issueAccessTokenJti({
    jti: access.jti,
    clientId,
    userId: existing.user_id,
    scope: existing.scope,
    expiresAt: access.expiresAt,
  });
  const refresh = await issueRefreshToken({
    clientId,
    userId: existing.user_id,
    scope: existing.scope,
    familyId: existing.family_id,
  });

  return successJson({
    access_token: access.jwt,
    token_type: 'Bearer',
    expires_in: oauthConfig.accessTokenTtlSeconds,
    refresh_token: refresh.token,
    scope: existing.scope,
  });
}
