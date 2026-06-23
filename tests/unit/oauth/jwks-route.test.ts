/**
 * SEC-33 — JWKS route. Behavioural: publishes only public RSA fields, never
 * leaks private material, 500s loudly when unconfigured, and a token signed by
 * the private key verifies against the published JWK.
 */
import { GET } from '@/app/api/well-known/jwks/route';
import { generateKeyPairSync } from 'crypto';
import { SignJWT, importJWK, importPKCS8, jwtVerify } from 'jose';

describe('GET /.well-known/jwks.json (SEC-33)', () => {
  let PRIV_PEM: string;
  let PUB_B64: string;

  beforeAll(() => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    PRIV_PEM = privateKey as string;
    PUB_B64 = Buffer.from(publicKey as string).toString('base64');
  });
  afterEach(() => {
    delete process.env.OAUTH_JWT_PUBLIC_KEY_B64;
    delete process.env.OAUTH_JWT_KID;
    delete process.env.OAUTH_JWT_PUBLIC_KEY_B64_NEXT;
    delete process.env.OAUTH_JWT_KID_NEXT;
  });

  test('publishes the public JWK with kty/n/e/alg/use/kid', async () => {
    process.env.OAUTH_JWT_PUBLIC_KEY_B64 = PUB_B64;
    process.env.OAUTH_JWT_KID = 'kid-1';
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keys).toHaveLength(1);
    const k = body.keys[0];
    expect(k.kty).toBe('RSA');
    expect(typeof k.n).toBe('string');
    expect(k.e).toBe('AQAB');
    expect(k.alg).toBe('RS256');
    expect(k.use).toBe('sig');
    expect(k.kid).toBe('kid-1');
  });

  test('never leaks private key fields', async () => {
    process.env.OAUTH_JWT_PUBLIC_KEY_B64 = PUB_B64;
    process.env.OAUTH_JWT_KID = 'kid-1';
    const k = (await (await GET()).json()).keys[0];
    for (const f of ['d', 'p', 'q', 'dp', 'dq', 'qi']) {
      expect(k[f]).toBeUndefined();
    }
  });

  test('a token signed by the private key verifies against the published JWK', async () => {
    process.env.OAUTH_JWT_PUBLIC_KEY_B64 = PUB_B64;
    process.env.OAUTH_JWT_KID = 'kid-1';
    const jwk = (await (await GET()).json()).keys[0];
    const pub = await importJWK(jwk, 'RS256');
    const priv = await importPKCS8(PRIV_PEM, 'RS256');
    const token = await new SignJWT({ scope: 'lyra:full' })
      .setProtectedHeader({ alg: 'RS256', kid: 'kid-1' })
      .setIssuer('https://dev.checklyra.com')
      .setSubject('user-x')
      .setExpirationTime('1h')
      .sign(priv);
    const { payload } = await jwtVerify(token, pub, {
      issuer: 'https://dev.checklyra.com',
      algorithms: ['RS256'],
    });
    expect(payload.sub).toBe('user-x');
  });

  test('publishes a rotation NEXT key alongside the current one', async () => {
    process.env.OAUTH_JWT_PUBLIC_KEY_B64 = PUB_B64;
    process.env.OAUTH_JWT_KID = 'kid-1';
    process.env.OAUTH_JWT_PUBLIC_KEY_B64_NEXT = PUB_B64;
    process.env.OAUTH_JWT_KID_NEXT = 'kid-2';
    const body = await (await GET()).json();
    expect(body.keys.map((k: { kid: string }) => k.kid)).toEqual(['kid-1', 'kid-2']);
  });

  test('returns 500 jwks_unavailable when public key/kid missing (no silent empty set)', async () => {
    const res = await GET();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('jwks_unavailable');
  });
});
