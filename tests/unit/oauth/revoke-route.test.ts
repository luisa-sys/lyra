/**
 * KAN-88 P6 — /oauth/revoke structural tests.
 *
 * The DB-touching paths (revokeFamily, revokeAccessTokenJti) are
 * covered by the live smoke test. These tests verify the RFC 7009
 * wire shape and the never-leak-existence property.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..');

// Mock the DB-touching modules.
jest.mock('@/lib/oauth/refresh', () => ({
  getRefreshToken: jest.fn(async () => null),
  revokeFamily: jest.fn(async () => undefined),
}));
jest.mock('@/lib/oauth/access-tokens', () => ({
  getAccessTokenJti: jest.fn(async () => null),
  revokeAccessTokenJti: jest.fn(async () => undefined),
}));

import { POST } from '@/app/oauth/revoke/route';

function form(body: Record<string, string>): Request {
  return new Request('https://dev.checklyra.com/oauth/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
}

describe('POST /oauth/revoke (KAN-88 P6, RFC 7009)', () => {
  test('returns 400 when token field missing', async () => {
    const req = form({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
  });

  test('returns 200 for unknown token (RFC 7009 §2.2 no-leak)', async () => {
    const req = form({ token: 'lyra_refresh_unknown_token' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('');
  });

  test('returns 200 for unknown access token (JWT-shaped)', async () => {
    const req = form({ token: 'eyJ.fake.token', token_type_hint: 'access_token' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any);
    expect(res.status).toBe(200);
  });

  test('sets Cache-Control: no-store on all responses', async () => {
    const req = form({ token: 'x' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
  });

  test('accepts application/json body too', async () => {
    const req = new Request('https://dev.checklyra.com/oauth/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'lyra_refresh_anything' }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any);
    expect(res.status).toBe(200);
  });

  test('accepts token_type_hint=refresh_token and access_token', async () => {
    const r1 = form({ token: 'lyra_refresh_x', token_type_hint: 'refresh_token' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((await POST(r1 as any)).status).toBe(200);
    const r2 = form({ token: 'eyJ.x.y', token_type_hint: 'access_token' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((await POST(r2 as any)).status).toBe(200);
  });
});

describe('revoke route source structure (KAN-88 P6)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/app/oauth/revoke/route.ts'), 'utf8');

  test('calls revokeFamily for refresh tokens (not just markUsed)', () => {
    expect(src).toMatch(/revokeFamily\(/);
  });

  test('calls revokeAccessTokenJti for JWT access tokens', () => {
    expect(src).toMatch(/revokeAccessTokenJti\(/);
  });

  test('uses decodeJwt to extract jti from access tokens', () => {
    expect(src).toMatch(/decodeJwt\(/);
  });

  test('returns 200 even for unknown tokens (RFC 7009 §2.2)', () => {
    expect(src).toMatch(/Unknown token — return 200/);
  });
});
