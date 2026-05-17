/**
 * JWT signing/verification for OAuth 2.1 access tokens — KAN-88 P4.
 *
 * HS256 with a shared secret (env: OAUTH_JWT_SIGNING_SECRET). The
 * secret MUST be the same on lyra (the AS — signs tokens here) and on
 * the MCP server (the RS — verifies tokens). Operationally, set the
 * same value on both Railway and Vercel.
 *
 * Migration to RS256 + JWKS is a follow-up ticket. The shape is
 * deliberately RFC 7519-standard so we can swap algorithms without
 * breaking consumers.
 *
 * Token shape (claims):
 *   iss: https://<this-deploy>            — AS URL
 *   sub: <user_id uuid>
 *   aud: <client_id>                      — the registered OAuth client
 *   exp: now + accessTokenTtlSeconds
 *   iat: now
 *   jti: <uuid>                           — for revocation tracking
 *   scope: 'lyra:full'
 *   client_id: <client_id>                — duplicates aud for compat
 *
 * The MCP server validates: signature, exp, iss, and (optionally)
 * looks up jti in oauth_access_tokens to honour revocations.
 */

import { SignJWT, jwtVerify } from 'jose';
import { randomUUID } from 'crypto';
import { oauthConfig } from './config';

function secretKey(): Uint8Array {
  const raw = process.env.OAUTH_JWT_SIGNING_SECRET;
  if (!raw || raw.length < 32) {
    throw new Error('OAUTH_JWT_SIGNING_SECRET must be set to at least 32 chars');
  }
  return new TextEncoder().encode(raw);
}

export interface AccessTokenClaims {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  jti: string;
  scope: string;
  client_id: string;
}

export interface IssueAccessTokenInput {
  userId: string;
  clientId: string;
  scope: string;
}

export interface IssuedAccessToken {
  jwt: string;
  jti: string;
  expiresAt: Date;
  claims: AccessTokenClaims;
}

export async function issueAccessToken(input: IssueAccessTokenInput): Promise<IssuedAccessToken> {
  const now = Math.floor(Date.now() / 1000);
  const ttl = oauthConfig.accessTokenTtlSeconds;
  const exp = now + ttl;
  const jti = randomUUID();
  const issuer = oauthConfig.issuer();

  const claims: AccessTokenClaims = {
    iss: issuer,
    sub: input.userId,
    aud: input.clientId,
    exp,
    iat: now,
    jti,
    scope: input.scope,
    client_id: input.clientId,
  };

  const jwt = await new SignJWT({
    scope: input.scope,
    client_id: input.clientId,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(issuer)
    .setSubject(input.userId)
    .setAudience(input.clientId)
    .setJti(jti)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(secretKey());

  return {
    jwt,
    jti,
    expiresAt: new Date(exp * 1000),
    claims,
  };
}

export interface VerifyOptions {
  /**
   * If provided, only tokens with this exact issuer claim are accepted.
   * Defaults to the runtime oauthConfig.issuer().
   */
  issuer?: string;
}

export async function verifyAccessToken(
  jwt: string,
  opts: VerifyOptions = {}
): Promise<{ ok: true; claims: AccessTokenClaims } | { ok: false; error: string }> {
  try {
    const { payload } = await jwtVerify(jwt, secretKey(), {
      issuer: opts.issuer ?? oauthConfig.issuer(),
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string') return { ok: false, error: 'missing sub' };
    if (typeof payload.jti !== 'string') return { ok: false, error: 'missing jti' };
    if (typeof payload.exp !== 'number') return { ok: false, error: 'missing exp' };
    if (typeof payload.iat !== 'number') return { ok: false, error: 'missing iat' };
    if (typeof payload.iss !== 'string') return { ok: false, error: 'missing iss' };
    if (typeof payload.aud !== 'string') return { ok: false, error: 'missing/multi aud' };
    if (typeof payload.scope !== 'string') return { ok: false, error: 'missing scope' };
    if (typeof payload.client_id !== 'string') return { ok: false, error: 'missing client_id' };
    return {
      ok: true,
      claims: {
        iss: payload.iss,
        sub: payload.sub,
        aud: payload.aud,
        exp: payload.exp,
        iat: payload.iat,
        jti: payload.jti,
        scope: payload.scope,
        client_id: payload.client_id,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return { ok: false, error: msg };
  }
}
