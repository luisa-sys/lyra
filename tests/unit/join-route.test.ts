/**
 * KAN-337 — the /join beta-invite deep-link route.
 *
 * A valid code stows the secret in a short-lived httpOnly cookie (so it survives
 * the Google-OAuth round-trip) and redirects to /signup?invited=1. An absent or
 * wrong code just lands the visitor on /signup with no cookie and no banner.
 */
let mockInviteCode = '';
jest.mock('@/lib/env', () => ({
  env: { inviteCode: () => mockInviteCode },
}));

import { GET } from '@/app/join/route';
import { NextRequest } from 'next/server';

function call(url: string) {
  return GET(new NextRequest(url));
}

beforeEach(() => {
  mockInviteCode = 'SECRET-123';
});

describe('KAN-337 /join', () => {
  it('valid code: sets the httpOnly lyra_invite cookie + redirects to /signup?invited=1', async () => {
    const res = await call('https://checklyra.com/join?code=SECRET-123');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://checklyra.com/signup?invited=1');
    expect(res.cookies.get('lyra_invite')?.value).toBe('SECRET-123');
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
  });

  it('trims surrounding whitespace before comparing', async () => {
    const res = await call('https://checklyra.com/join?code=' + encodeURIComponent('  SECRET-123  '));
    expect(res.headers.get('location')).toBe('https://checklyra.com/signup?invited=1');
    expect(res.cookies.get('lyra_invite')?.value).toBe('SECRET-123');
  });

  it('wrong code: redirects to /signup with no cookie', async () => {
    const res = await call('https://checklyra.com/join?code=nope');
    expect(res.headers.get('location')).toBe('https://checklyra.com/signup');
    expect(res.cookies.get('lyra_invite')).toBeUndefined();
  });

  it('no code: redirects to /signup with no cookie', async () => {
    const res = await call('https://checklyra.com/join');
    expect(res.headers.get('location')).toBe('https://checklyra.com/signup');
    expect(res.cookies.get('lyra_invite')).toBeUndefined();
  });

  it('feature off (no configured code): never sets a cookie', async () => {
    mockInviteCode = '';
    const res = await call('https://checklyra.com/join?code=anything');
    expect(res.headers.get('location')).toBe('https://checklyra.com/signup');
    expect(res.cookies.get('lyra_invite')).toBeUndefined();
  });
});
