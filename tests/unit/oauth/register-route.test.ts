/**
 * KAN-88 P2 — POST /oauth/register structural + error-path tests.
 *
 * Doesn't hit Supabase — that's covered by the live smoke test after
 * deploy. These tests verify the wire shape (status codes, headers,
 * error format) is RFC 7591 compliant.
 */

import { POST } from '@/app/oauth/register/route';

function fakePost(body: unknown): Request {
  return new Request('https://dev.checklyra.com/oauth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /oauth/register (KAN-88 P2)', () => {
  test('returns 400 + invalid_client_metadata for non-JSON body', async () => {
    const req = new Request('https://dev.checklyra.com/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_client_metadata');
  });

  test('returns 400 + invalid_redirect_uri for non-https redirect', async () => {
    const req = fakePost({
      client_name: 'Bad',
      redirect_uris: ['http://evil.com/cb'],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_redirect_uri');
    expect(body.error_description).toMatch(/https/);
  });

  test('returns 400 for missing client_name', async () => {
    const req = fakePost({ redirect_uris: ['https://x.com/cb'] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  test('error responses set Cache-Control: no-store', async () => {
    const req = fakePost({ client_name: '', redirect_uris: ['https://x.com/cb'] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
  });

  test('rejects redirect_uri with fragment per RFC 6749 §3.1.2', async () => {
    const req = fakePost({
      client_name: 'X',
      redirect_uris: ['https://x.com/cb#frag'],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_redirect_uri');
    expect(body.error_description).toMatch(/fragment/);
  });

  // SEC-19/F-05 — Dynamic Client Registration is rate-limited per IP.
  test('rate-limits registration per IP after the cap (429)', async () => {
    const ip = '203.0.113.55'; // unique IP → isolated rate-limit bucket for this test
    const reg = () => {
      const req = new Request('https://dev.checklyra.com/oauth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
        // invalid body → 400 on validation; the point is the rate-limit gate runs first
        body: JSON.stringify({ redirect_uris: ['https://x.com/cb'] }),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return POST(req as any);
    };
    // First 5 are within the limit (validation 400, NOT rate-limited).
    for (let i = 0; i < 5; i++) {
      const res = await reg();
      expect(res.status).not.toBe(429);
    }
    // The 6th trips the per-IP cap.
    const limited = await reg();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
    const body = await limited.json();
    expect(body.error).toBe('too_many_requests');
  });
});
