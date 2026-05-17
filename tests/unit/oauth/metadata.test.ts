/**
 * KAN-88 — OAuth AS metadata endpoint tests.
 *
 * The route is exposed at /.well-known/oauth-authorization-server via
 * a next.config rewrite, and the handler lives at
 * /api/well-known/oauth-authorization-server/route.ts. We test the
 * handler directly here; the rewrite is covered by a structural
 * test on next.config.ts.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..');

// Handler import — under jest.config the @ alias resolves into src/.
import { GET } from '@/app/api/well-known/oauth-authorization-server/route';

describe('GET /.well-known/oauth-authorization-server (KAN-88)', () => {
  const ORIGINAL_URL = process.env.NEXT_PUBLIC_SITE_URL;
  const ORIGINAL_VERCEL = process.env.VERCEL_URL;
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.VERCEL_URL;
  });
  afterAll(() => {
    if (ORIGINAL_URL !== undefined) process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL_URL;
    if (ORIGINAL_VERCEL !== undefined) process.env.VERCEL_URL = ORIGINAL_VERCEL;
  });

  test('returns 200 with application/json', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  test('contains required RFC 8414 fields', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://dev.checklyra.com';
    const res = await GET();
    const body = await res.json();
    expect(body.issuer).toBe('https://dev.checklyra.com');
    expect(body.authorization_endpoint).toBe('https://dev.checklyra.com/oauth/authorize');
    expect(body.token_endpoint).toBe('https://dev.checklyra.com/oauth/token');
    expect(body.registration_endpoint).toBe('https://dev.checklyra.com/oauth/register');
    expect(body.revocation_endpoint).toBe('https://dev.checklyra.com/oauth/revoke');
    expect(body.response_types_supported).toEqual(['code']);
    expect(body.grant_types_supported).toEqual(expect.arrayContaining(['authorization_code', 'refresh_token']));
  });

  test('advertises PKCE S256 (not plain)', async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.code_challenge_methods_supported).toEqual(['S256']);
  });

  test('advertises public-client (token_endpoint_auth_methods = none)', async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.token_endpoint_auth_methods_supported).toEqual(['none']);
  });

  test('advertises lyra:full scope', async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.scopes_supported).toContain('lyra:full');
  });

  test('uses VERCEL_URL fallback when NEXT_PUBLIC_SITE_URL absent', async () => {
    process.env.VERCEL_URL = 'lyra-abc123.vercel.app';
    const res = await GET();
    const body = await res.json();
    expect(body.issuer).toBe('https://lyra-abc123.vercel.app');
  });

  test('sets CORS open + short cache so clients can discover us', async () => {
    const res = await GET();
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cache-control')).toMatch(/max-age=\d+/);
  });
});

describe('next.config.ts rewrite for /.well-known/oauth-authorization-server (KAN-88)', () => {
  test('rewrite is configured', () => {
    const src = fs.readFileSync(path.join(ROOT, 'next.config.ts'), 'utf8');
    expect(src).toMatch(/source:\s*['"]\/\.well-known\/oauth-authorization-server['"]/);
    expect(src).toMatch(/destination:\s*['"]\/api\/well-known\/oauth-authorization-server['"]/);
  });
});

describe('oauth config (KAN-88)', () => {
  test('TTLs match documented values', async () => {
    const { oauthConfig } = await import('@/lib/oauth/config');
    expect(oauthConfig.authorizationCodeTtlSeconds).toBe(600); // 10 min
    expect(oauthConfig.accessTokenTtlSeconds).toBe(3600); // 1h
    expect(oauthConfig.refreshTokenTtlSeconds).toBe(30 * 24 * 60 * 60); // 30d
  });

  test('wwwAuthenticateHeader builds the right shape', async () => {
    const { wwwAuthenticateHeader, oauthConfig } = await import('@/lib/oauth/config');
    const plain = wwwAuthenticateHeader();
    expect(plain).toMatch(/^Bearer realm="/);
    expect(plain).toContain(oauthConfig.issuer());

    const withErr = wwwAuthenticateHeader({ error: 'invalid_token', errorDescription: 'expired' });
    expect(withErr).toContain('error="invalid_token"');
    expect(withErr).toContain('error_description="expired"');
  });
});
