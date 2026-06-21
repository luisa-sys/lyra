/**
 * BUGS-50 — /auth/confirm token-hash route.
 *
 * The route verifies an emailed one-time token with `verifyOtp({ type,
 * token_hash })` — which, unlike the PKCE code exchange in /auth/callback,
 * needs NO browser-bound code verifier, so the magic link works when opened
 * in a different browser / mail-app webview. These tests exercise the wire
 * behaviour (which Supabase method is called, and where the route redirects)
 * with the Supabase client and the shared beta-routing helper mocked.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

// ───────────── Mocks ─────────────

const mockVerifyOtp = jest.fn();
const mockGetUser = jest.fn();

jest.mock('@/lib/supabase-server', () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: {
      verifyOtp: (args: unknown) => mockVerifyOtp(args),
      getUser: () => mockGetUser(),
    },
  }),
}));

// The route delegates post-login routing to this helper; stub it with a
// recognisable sentinel so we can assert the route honours its result for the
// signup/magic-link paths (the helper itself is covered separately).
const SENTINEL = 'https://dev.checklyra.com/dashboard';
const mockResolvePostLoginRedirect = jest.fn().mockResolvedValue(SENTINEL);
jest.mock('@/lib/auth/post-login-redirect', () => ({
  resolvePostLoginRedirect: (...args: unknown[]) => mockResolvePostLoginRedirect(...args),
}));

import { GET } from '@/app/auth/confirm/route';

const ORIGIN = 'https://dev.checklyra.com';

function callConfirm(query: string): Promise<Response> {
  return GET(new Request(`${ORIGIN}/auth/confirm${query}`));
}

beforeEach(() => {
  mockVerifyOtp.mockReset();
  mockGetUser.mockReset();
  mockResolvePostLoginRedirect.mockClear();
  mockResolvePostLoginRedirect.mockResolvedValue(SENTINEL);
});

// ───────────── Behaviour ─────────────

describe('GET /auth/confirm (BUGS-50 token-hash flow)', () => {
  test('signup: verifies the token hash and routes via the beta helper', async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });
    const res = await callConfirm('?token_hash=abc123&type=signup');

    expect(mockVerifyOtp).toHaveBeenCalledWith({ type: 'signup', token_hash: 'abc123' });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(SENTINEL);
    expect(mockResolvePostLoginRedirect).toHaveBeenCalledWith(
      expect.anything(),
      ORIGIN,
      '/dashboard',
    );
  });

  test('magiclink: verifies and routes via the beta helper, honouring next', async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });
    const res = await callConfirm('?token_hash=h&type=magiclink&next=/dashboard/profile');

    expect(mockVerifyOtp).toHaveBeenCalledWith({ type: 'magiclink', token_hash: 'h' });
    expect(res.headers.get('location')).toBe(SENTINEL);
    expect(mockResolvePostLoginRedirect).toHaveBeenCalledWith(
      expect.anything(),
      ORIGIN,
      '/dashboard/profile',
    );
  });

  test('recovery: verifies then sends straight to /reset-password (never beta routing)', async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });
    const res = await callConfirm('?token_hash=r&type=recovery');

    expect(mockVerifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 'r' });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/reset-password`);
    expect(mockResolvePostLoginRedirect).not.toHaveBeenCalled();
  });

  test('verifyOtp failure (expired / already-used token): redirects to /login?error', async () => {
    mockVerifyOtp.mockResolvedValue({ error: { message: 'Token has expired or is invalid' } });
    const res = await callConfirm('?token_hash=stale&type=signup');

    expect(mockVerifyOtp).toHaveBeenCalled();
    expect(res.status).toBe(307);
    const loc = res.headers.get('location') ?? '';
    expect(loc.startsWith(`${ORIGIN}/login?error=`)).toBe(true);
    expect(decodeURIComponent(loc)).toMatch(/could not verify your email/i);
    expect(mockResolvePostLoginRedirect).not.toHaveBeenCalled();
  });

  test('missing token_hash: redirects to /login?error without calling verifyOtp', async () => {
    const res = await callConfirm('?type=signup');
    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(res.headers.get('location') ?? '').toMatch(/\/login\?error=/);
  });

  test('missing type: redirects to /login?error without calling verifyOtp', async () => {
    const res = await callConfirm('?token_hash=abc');
    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(res.headers.get('location') ?? '').toMatch(/\/login\?error=/);
  });

  test('disallowed type is rejected before any verification', async () => {
    const res = await callConfirm('?token_hash=abc&type=bogus');
    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(res.headers.get('location') ?? '').toMatch(/\/login\?error=/);
  });
});

// ───────────── Static-grep surface guards ─────────────

describe('BUGS-50: auth-route surface guards', () => {
  test('/auth/confirm route exists and uses verifyOtp (not the PKCE code exchange)', () => {
    const p = resolve(ROOT, 'src/app/auth/confirm/route.ts');
    expect(existsSync(p)).toBe(true);
    const src = readFileSync(p, 'utf-8');
    expect(src).toMatch(/verifyOtp/);
    expect(src).toMatch(/token_hash/);
    // Must not *call* the PKCE code exchange (mentioning it in a comment is fine).
    expect(src).not.toMatch(/exchangeCodeForSession\s*\(/);
  });

  test('/auth/callback is still the OAuth code-exchange route (regression guard)', () => {
    const src = readFileSync(resolve(ROOT, 'src/app/auth/callback/route.ts'), 'utf-8');
    expect(src).toMatch(/exchangeCodeForSession/);
    expect(src).toMatch(/searchParams\.get\(['"]next['"]\)/);
  });
});
