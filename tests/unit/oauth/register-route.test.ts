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
});
