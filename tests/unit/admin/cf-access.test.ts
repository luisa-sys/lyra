/**
 * SEC-34 — app-layer Cloudflare Access verification (`src/lib/cf-access.ts`).
 *
 * Only the remote JWKS fetch is mocked: we swap `createRemoteJWKSet` for a local
 * key set built from an ephemeral RSA keypair, so the real jose signature /
 * issuer / audience / expiry checks are exercised end-to-end.
 */
import { generateKeyPairSync } from 'crypto';

jest.mock('jose', () => {
  const actual = jest.requireActual('jose');
  return { ...actual, createRemoteJWKSet: jest.fn() };
});

import {
  createRemoteJWKSet,
  SignJWT,
  importPKCS8,
  importSPKI,
  exportJWK,
  createLocalJWKSet,
} from 'jose';
import {
  cfAccessEnabled,
  verifyCfAccessToken,
  __resetCfAccessJwksCacheForTests,
} from '@/lib/cf-access';

const TEAM = 'lyra-test';
const ISS = `https://${TEAM}.cloudflareaccess.com`;
const AUD = 'test-aud-abc123';
const ORIG = { ...process.env };

let signKey: Awaited<ReturnType<typeof importPKCS8>>;

beforeAll(async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  signKey = await importPKCS8(privateKey as string, 'RS256');
  const pub = await importSPKI(publicKey as string, 'RS256');
  const jwk = await exportJWK(pub);
  jwk.kid = 'cf-test';
  jwk.alg = 'RS256';
  // Every createRemoteJWKSet() call returns a local resolver over our test key.
  (createRemoteJWKSet as jest.Mock).mockReturnValue(createLocalJWKSet({ keys: [jwk] }));
});

afterEach(() => {
  process.env = { ...ORIG };
  __resetCfAccessJwksCacheForTests();
});

function enable() {
  process.env.CF_ACCESS_TEAM_DOMAIN = TEAM;
  process.env.CF_ACCESS_AUD = AUD;
}

function signCf(opts: { iss?: string; aud?: string } = {}): Promise<string> {
  return new SignJWT({ email: 'admin@checklyra.com' })
    .setProtectedHeader({ alg: 'RS256', kid: 'cf-test' })
    .setIssuer(opts.iss ?? ISS)
    .setAudience(opts.aud ?? AUD)
    .setExpirationTime('1h')
    .sign(signKey);
}

describe('cfAccessEnabled (SEC-34)', () => {
  test('false when both env vars unset', () => {
    delete process.env.CF_ACCESS_TEAM_DOMAIN;
    delete process.env.CF_ACCESS_AUD;
    expect(cfAccessEnabled()).toBe(false);
  });
  test('false when only one is set', () => {
    process.env.CF_ACCESS_TEAM_DOMAIN = TEAM;
    delete process.env.CF_ACCESS_AUD;
    expect(cfAccessEnabled()).toBe(false);
  });
  test('true when both set', () => {
    enable();
    expect(cfAccessEnabled()).toBe(true);
  });
});

describe('verifyCfAccessToken (SEC-34)', () => {
  test('INERT: allows everything when unconfigured (even with no token)', async () => {
    delete process.env.CF_ACCESS_TEAM_DOMAIN;
    delete process.env.CF_ACCESS_AUD;
    expect(await verifyCfAccessToken(null)).toBe(true);
    expect(await verifyCfAccessToken('whatever')).toBe(true);
  });

  test('configured + missing/empty token → false (the origin-bypass block)', async () => {
    enable();
    expect(await verifyCfAccessToken(null)).toBe(false);
    expect(await verifyCfAccessToken(undefined)).toBe(false);
    expect(await verifyCfAccessToken('')).toBe(false);
  });

  test('configured + valid CF Access token → true', async () => {
    enable();
    expect(await verifyCfAccessToken(await signCf())).toBe(true);
  });

  test('configured + wrong audience → false', async () => {
    enable();
    expect(await verifyCfAccessToken(await signCf({ aud: 'some-other-access-app' }))).toBe(false);
  });

  test('configured + wrong issuer → false', async () => {
    enable();
    expect(await verifyCfAccessToken(await signCf({ iss: 'https://evil.cloudflareaccess.com' }))).toBe(false);
  });

  test('configured + malformed token → false', async () => {
    enable();
    expect(await verifyCfAccessToken('not.a.jwt')).toBe(false);
  });
});
