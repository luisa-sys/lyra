/**
 * KAN-88 P4 — JWT signing/verification + PKCE.
 *
 * Pure crypto, no DB. Sets a 32-char OAUTH_JWT_SIGNING_SECRET for
 * the test process and verifies the round-trip + tamper-detection.
 */

import { issueAccessToken, verifyAccessToken } from '@/lib/oauth/jwt';
import { verifyPkceS256 } from '@/lib/oauth/pkce';
import { createHash } from 'crypto';

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

  test('round-trips with correct claims', async () => {
    const issued = await issueAccessToken({ userId, clientId, scope: 'lyra:full' });
    expect(issued.jwt.split('.').length).toBe(3); // header.payload.signature
    const v = await verifyAccessToken(issued.jwt);
    if (!v.ok) throw new Error(`expected ok, got ${v.error}`);
    expect(v.claims.iss).toBe('https://dev.checklyra.com');
    expect(v.claims.sub).toBe(userId);
    expect(v.claims.aud).toBe(clientId);
    expect(v.claims.scope).toBe('lyra:full');
    expect(v.claims.client_id).toBe(clientId);
    expect(typeof v.claims.jti).toBe('string');
    expect(v.claims.jti.length).toBeGreaterThan(20);
  });

  test('rejects tampered payload (signature invalid)', async () => {
    const issued = await issueAccessToken({ userId, clientId, scope: 'lyra:full' });
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
    const issued = await issueAccessToken({ userId, clientId, scope: 'lyra:full' });
    const v = await verifyAccessToken(issued.jwt, { issuer: 'https://evil.com' });
    expect(v.ok).toBe(false);
  });

  test('expiresAt is roughly accessTokenTtlSeconds from now', async () => {
    const issued = await issueAccessToken({ userId, clientId, scope: 'lyra:full' });
    const dt = (issued.expiresAt.getTime() - Date.now()) / 1000;
    // Default TTL is 3600s. Allow ±2s for test latency.
    expect(dt).toBeGreaterThan(3598);
    expect(dt).toBeLessThan(3602);
  });

  test('throws when secret is missing/short', async () => {
    const orig = process.env.OAUTH_JWT_SIGNING_SECRET;
    process.env.OAUTH_JWT_SIGNING_SECRET = 'short';
    await expect(issueAccessToken({ userId, clientId, scope: 'lyra:full' })).rejects.toThrow(/32 chars/);
    process.env.OAUTH_JWT_SIGNING_SECRET = orig;
  });

  test('each token has a unique jti', async () => {
    const a = await issueAccessToken({ userId, clientId, scope: 'lyra:full' });
    const b = await issueAccessToken({ userId, clientId, scope: 'lyra:full' });
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
