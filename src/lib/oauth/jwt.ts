/**
 * JWT signing/verification for OAuth 2.1 access tokens — KAN-88 / SEC-33.
 *
 * Signs **RS256** with an asymmetric private key (env OAUTH_JWT_PRIVATE_KEY_B64
 * = base64 of a PKCS8 PEM; key id in OAUTH_JWT_KID) and publishes the matching
 * public key at /.well-known/jwks.json, so resource servers (the MCP servers)
 * verify with NO shared secret.
 *
 * Migration safety: if no private key is configured, it falls back to the
 * legacy **HS256** shared secret (OAUTH_JWT_SIGNING_SECRET). This lets the code
 * deploy *before* the keypair is set without breaking token issuance — and the
 * MCP verifiers accept both algorithms during the overlap. The HS256 path is
 * removed once every environment has a keypair (SEC-33 teardown).
 *
 * Token shape (claims) is RFC 7519-standard and UNCHANGED by the alg switch:
 *   iss, sub, aud, exp, iat, jti, scope, client_id.
 */

import { SignJWT, jwtVerify, importPKCS8, importSPKI } from 'jose';
import { randomUUID } from 'crypto';
import { oauthConfig } from './config';

function pemFromB64(b64: string): string {
  return Buffer.from(b64, 'base64').toString('utf8');
}

function hsSecret(): Uint8Array {
  const raw = process.env.OAUTH_JWT_SIGNING_SECRET;
  if (!raw || raw.length < 32) {
    throw new Error('OAUTH_JWT_SIGNING_SECRET must be set to at least 32 chars');
  }
  return new TextEncoder().encode(raw);
}

/** RS256 signing key (PKCS8), imported once. null when not configured → HS256. */
let _privateKey: Promise<CryptoKey> | null = null;
function privateKey(): Promise<CryptoKey> | null {
  const b64 = process.env.OAUTH_JWT_PRIVATE_KEY_B64;
  if (!b64) return null;
  if (!_privateKey) _privateKey = importPKCS8(pemFromB64(b64), 'RS256');
  return _privateKey;
}

/** RS256 public key (SPKI) for the AS self-check verify. null when not configured. */
let _publicKey: Promise<CryptoKey> | null = null;
function publicKey(): Promise<CryptoKey> | null {
  const b64 = process.env.OAUTH_JWT_PUBLIC_KEY_B64;
  if (!b64) return null;
  if (!_publicKey) _publicKey = importSPKI(pemFromB64(b64), 'RS256');
  return _publicKey;
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

  const builder = new SignJWT({ scope: input.scope, client_id: input.clientId })
    .setIssuer(issuer)
    .setSubject(input.userId)
    .setAudience(input.clientId)
    .setJti(jti)
    .setIssuedAt(now)
    .setExpirationTime(exp);

  const priv = privateKey();
  let jwt: string;
  if (priv) {
    // Primary: RS256, kid lets verifiers select the key from the JWKS.
    jwt = await builder
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: process.env.OAUTH_JWT_KID })
      .sign(await priv);
  } else {
    // Legacy fallback: HS256 shared secret (no asymmetric key configured yet).
    jwt = await builder.setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).sign(hsSecret());
  }

  return { jwt, jti, expiresAt: new Date(exp * 1000), claims };
}

export interface VerifyOptions {
  /**
   * If provided, only tokens with this exact issuer claim are accepted.
   * Defaults to the runtime oauthConfig.issuer().
   */
  issuer?: string;
}

/**
 * AS-side self-check verifier (the load-bearing verification is the MCP resource
 * server's). Verifies with whatever this AS is configured to sign: RS256 via the
 * public key when configured, else legacy HS256.
 */
export async function verifyAccessToken(
  jwt: string,
  opts: VerifyOptions = {}
): Promise<{ ok: true; claims: AccessTokenClaims } | { ok: false; error: string }> {
  try {
    const issuer = opts.issuer ?? oauthConfig.issuer();
    const pub = publicKey();
    const { payload } = pub
      ? await jwtVerify(jwt, await pub, { issuer, algorithms: ['RS256'] })
      : await jwtVerify(jwt, hsSecret(), { issuer, algorithms: ['HS256'] });
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
