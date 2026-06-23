/**
 * /.well-known/jwks.json — OAuth JWKS (SEC-33).
 *
 * Publishes the AS's RS256 PUBLIC key(s) so resource servers verify access
 * tokens with no shared secret. Only ever exposes public fields: we import the
 * SPKI *public* PEM and explicitly construct the JWK from {kty,n,e} so private
 * fields (d,p,q,dp,dq,qi) can never leak even if the env held a private key.
 *
 * Supports key rotation by publishing a NEXT key alongside the current one.
 * Returns 500 (never an empty/placeholder key set) if the public key is missing.
 */
import { NextResponse } from 'next/server';
import { importSPKI, exportJWK } from 'jose';

export const dynamic = 'force-dynamic'; // env-driven — never cache at the framework layer

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=300',
};

function pemFromB64(b64: string): string {
  return Buffer.from(b64, 'base64').toString('utf8');
}

async function publicJwk(b64: string, kid: string) {
  const key = await importSPKI(pemFromB64(b64), 'RS256');
  const jwk = await exportJWK(key);
  // Defence in depth: publish ONLY public RSA fields + metadata — never spread
  // the raw jwk (which could carry private fields if a private key slipped in).
  return { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', use: 'sig', kid };
}

export async function GET() {
  const b64 = process.env.OAUTH_JWT_PUBLIC_KEY_B64;
  const kid = process.env.OAUTH_JWT_KID;
  if (!b64 || !kid) {
    // Loud failure, not a silent empty key set (workflow-integrity policy).
    return NextResponse.json({ error: 'jwks_unavailable' }, { status: 500, headers: CORS });
  }

  const keys = [await publicJwk(b64, kid)];

  // Rotation overlap: publish the next key too, so verifiers accept both kids.
  const nextB64 = process.env.OAUTH_JWT_PUBLIC_KEY_B64_NEXT;
  const nextKid = process.env.OAUTH_JWT_KID_NEXT;
  if (nextB64 && nextKid) {
    keys.push(await publicJwk(nextB64, nextKid));
  }

  return NextResponse.json({ keys }, { headers: CORS });
}
