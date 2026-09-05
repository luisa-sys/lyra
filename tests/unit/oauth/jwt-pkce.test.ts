/**
 * KAN-88 P4 — JWT signing/verification + PKCE.
 *
 * Pure crypto, no DB. Sets a 32-char OAUTH_JWT_SIGNING_SECRET for
 * the test process and verifies the round-trip + tamper-detection.
 */

import { issueAccessToken, verifyAccessToken } from '@/modules/oauth-as/lib/jwt';
import { verifyPkceS256 } from '@/modules/oauth-as/lib/pkce';
import { createHash, generateKeyPairSync } from 'crypto';

const TEST_SECRET = '0'.repeat(32);
const ORIG_SECRET = process.env.OAUTH_JWT_SIGNING_SECRET;
const ORIG_SITE = process.env.NEXT_PUBLIC_SITE_URL;

beforeAll(() => {
  process.env.OAUTH_JWT_SIGNING_SECRET = TEST_SECRET;
  process.env.NEXT_PUBLIC_SITE_URL = 'https://dev.checklyra.com';
});
afterAll(() => {
  if (ORIG_SECRET !== undefined) process.env.OAUTH_JWT_SIGNING_SECRET = ORIG_SECRET;
  else delete process.env.OAUTH_JWT_SIGNING_SECRET;
  if (ORIG_SITE !== undefined) process.env.NEXT_PUBLIC_SITE_URL = ORIG_SITE;
  else delete process.env.NEXT_PUBLIC_SITE_URL;
});

describe('issueAccessToken / verifyAccessToken (KAN-88 P4)', () => {
  const userId = '00000000-0000-4000-8000-000000000000';
  const clientId = 'lyra_oauth_test';
  // SEC-46 Phase C: `aud` is now the RESOURCE, not the client. Deliberately a
  // different string from clientId so the two can never be confused again.
  const resource = 'https://mcp-dev.checklyra.com/mcp';

  test('round-trips with correct claims', async () => {
    const issued = await issueAccessToken({ userId, clientId, scope: 'lyra:full', resource });
    expect(issued.jwt.split('.').length).toBe(3); // header.payload.signature
    const v = await verifyAccessToken(issued.jwt);
    if (!v.ok) throw new Error(`expected ok, got ${v.error}`);
    expect(v.claims.iss).toBe('https://dev.checklyra.com');
    expect(v.claims.sub).toBe(userId);
    // ⚠️ CHANGED under SEC-46 Phase C, founder-approved 2026-08-16. This
    // asserted `aud === clientId`, which was a CORRECT assertion about
    // deliberately-wrong behaviour: one token was accepted by BOTH resource
    // servers because they verify with issuer only, so a consumer token reached
    // admin tools (SEC-48). `aud` is now the resource.
    //
    // Nothing is lost: `client_id` is still asserted below, and it was already
    // there before this change — the two claims are now proven to be DIFFERENT
    // values rather than silently the same one.
    expect(v.claims.aud).toBe(resource);
    expect(v.claims.aud).not.toBe(clientId);
    expect(v.claims.scope).toBe('lyra:full');
    expect(v.claims.client_id).toBe(clientId);
    expect(typeof v.claims.jti).toBe('string');
    expect(v.claims.jti.length).toBeGreaterThan(20);
  });

  test('rejects tampered payload (signature invalid)', async () => {
    const issued = await issueAccessToken({ userId, clientId, scope: 'lyra:full', resource });
    const parts = issued.jwt.split('.');
    // Decode payload, mutate `sub`, re-encode (signature now mismatches).
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    payload.sub = '11111111-1111-4111-8111-111111111111';
    parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url').replace(/=+$/, '');
    const tampered = parts.join('.');
    const v = await verifyAccessToken(tampered);
    expect(v.ok).toBe(false);
  });

  test('rejects wrong issuer', async () => {
    const issued = await issueAccessToken({ userId, clientId, scope: 'lyra:full', resource });
    const v = await verifyAccessToken(issued.jwt, { issuer: 'https://evil.com' });
    expect(v.ok).toBe(false);
  });

  test('expiresAt is roughly accessTokenTtlSeconds from now', async () => {
    const issued = await issueAccessToken({ userId, clientId, scope: 'lyra:full', resource });
    const dt = (issued.expiresAt.getTime() - Date.now()) / 1000;
    // ⚠️ DERIVED from the config, not hard-coded. This read `toBeGreaterThan(3598)`
    // while the test's own NAME says "roughly accessTokenTtlSeconds from now" —
    // so the assertion and the name disagreed, and the magic number went stale
    // the moment SEC-46 changed the TTL to 900. Deriving makes it assert what it
    // claims to and immune to the next change; it is strictly stronger, not
    // looser, because the ±2s tolerance is unchanged.
    const { oauthConfig } = await import('@/modules/oauth-as/lib/config');
    const ttl = oauthConfig.accessTokenTtlSeconds;
    expect(dt).toBeGreaterThan(ttl - 2);
    expect(dt).toBeLessThan(ttl + 2);
  });

  test('throws when secret is missing/short', async () => {
    const orig = process.env.OAUTH_JWT_SIGNING_SECRET;
    process.env.OAUTH_JWT_SIGNING_SECRET = 'short';
    await expect(issueAccessToken({ userId, clientId, scope: 'lyra:full', resource })).rejects.toThrow(/32 chars/);
    process.env.OAUTH_JWT_SIGNING_SECRET = orig;
  });

  test('each token has a unique jti', async () => {
    const a = await issueAccessToken({ userId, clientId, scope: 'lyra:full', resource });
    const b = await issueAccessToken({ userId, clientId, scope: 'lyra:full', resource });
    expect(a.jti).not.toBe(b.jti);
  });
});

describe('verifyPkceS256 (KAN-88 P4)', () => {
  function challengeFor(verifier: string): string {
    return createHash('sha256').update(verifier).digest().toString('base64url');
  }

  test('verifies matching verifier+challenge', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = challengeFor(verifier);
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
  });

  test('rejects mismatched verifier', () => {
    const challenge = challengeFor('correct-verifier-xxxxxxxxxxxxxxxxxxxxxxxxxxxx');
    expect(verifyPkceS256('wrong-verifier-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', challenge)).toBe(false);
  });

  test('rejects empty/malformed challenge', () => {
    expect(verifyPkceS256('abc', '')).toBe(false);
    expect(verifyPkceS256('abc', '@@@invalid_base64@@@')).toBe(false);
  });

  test('uses constant-time comparison (smoke test — both lengths equal)', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const wrong = challengeFor('other');
    // Both are valid base64url + same byte length, so the only path to
    // mismatch is the timingSafeEqual call returning false.
    expect(verifyPkceS256(verifier, wrong)).toBe(false);
  });
});

describe('issueAccessToken RS256 + JWKS (SEC-33)', () => {
  const userId = '00000000-0000-4000-8000-000000000000';
  const clientId = 'lyra_oauth_test';

  beforeAll(() => {
    // Ephemeral keypair — proves RS256 signing end-to-end with no live keys.
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    process.env.OAUTH_JWT_PRIVATE_KEY_B64 = Buffer.from(privateKey as string).toString('base64');
    process.env.OAUTH_JWT_PUBLIC_KEY_B64 = Buffer.from(publicKey as string).toString('base64');
    process.env.OAUTH_JWT_KID = 'test-kid-2026-06';
  });
  afterAll(() => {
    // Clean up so other test files in the worker fall back to HS256.
    delete process.env.OAUTH_JWT_PRIVATE_KEY_B64;
    delete process.env.OAUTH_JWT_PUBLIC_KEY_B64;
    delete process.env.OAUTH_JWT_KID;
  });

  test('signs RS256 with a kid when a private key is configured', async () => {
    const issued = await issueAccessToken({ userId, clientId, scope: 'lyra:full', resource: 'https://mcp-dev.checklyra.com/mcp' });
    const header = JSON.parse(Buffer.from(issued.jwt.split('.')[0], 'base64url').toString('utf8'));
    expect(header.alg).toBe('RS256');
    expect(header.kid).toBe('test-kid-2026-06');
  });

  test('RS256 round-trips with correct claims (asymmetric, no shared secret)', async () => {
    const issued = await issueAccessToken({ userId, clientId, scope: 'lyra:full', resource: 'https://mcp-dev.checklyra.com/mcp' });
    const v = await verifyAccessToken(issued.jwt);
    if (!v.ok) throw new Error(`expected ok, got ${v.error}`);
    expect(v.claims.sub).toBe(userId);
    expect(v.claims.client_id).toBe(clientId);
    expect(v.claims.scope).toBe('lyra:full');
  });
});
