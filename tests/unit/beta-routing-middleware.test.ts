/**
 * KAN-278 — approved-user routing in src/middleware.ts.
 *
 * Drives the real middleware() with a fake NextRequest, mocking only the
 * Supabase SSR client (so we control the authenticated user + their
 * beta_access_status) and the rate-limiter. Asserts:
 *   - approved user + BETA_ROUTING_ENABLED=true on PROD → 307 redirect to
 *     beta.checklyra.com, path preserved.
 *   - flag off → no beta redirect (request passes through).
 *   - exempt paths (/auth/*, /api/*) → never redirected to beta.
 *   - non-approved user → unaffected.
 *   - on the beta deploy itself (IS_BETA_DEPLOY=true) → never bounces to beta.
 */

const getUserMock = jest.fn();
const profileMaybeSingleMock = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn(() => ({
    auth: { getUser: (...a: unknown[]) => getUserMock(...a) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: (...a: unknown[]) => profileMaybeSingleMock(...a),
        }),
      }),
    }),
  })),
}));

jest.mock('@/lib/rate-limit', () => ({
  rateLimit: () => ({ limited: false }),
  RATE_LIMITS: { auth: {} },
}));

import { middleware } from '@/middleware';

// Minimal NextRequest-like object. middleware reads: nextUrl (pathname,
// searchParams, search, clone), headers, method, cookies.getAll.
function makeRequest(pathname: string, search = ''): unknown {
  const url = new URL(`https://checklyra.com${pathname}${search}`);
  return {
    nextUrl: url,
    method: 'GET',
    headers: new Headers(),
    cookies: { getAll: () => [], set: () => {} },
  };
}

const ENV_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'IS_BETA_DEPLOY',
  'BETA_ROUTING_ENABLED',
  'BETA_APP_URL',
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  getUserMock.mockReset();
  profileMaybeSingleMock.mockReset();
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  // Supabase must be "configured" for the middleware to run the auth path.
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  delete process.env.IS_BETA_DEPLOY;
  delete process.env.BETA_ROUTING_ENABLED;
  delete process.env.BETA_APP_URL;
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  profileMaybeSingleMock.mockResolvedValue({ data: { beta_access_status: 'approved', is_beta_eligible: true } });
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
});

describe('KAN-278 approved-user routing', () => {
  test('approved user + flag on (prod) → redirects to beta, path preserved', async () => {
    process.env.BETA_ROUTING_ENABLED = 'true';
    const res = await middleware(makeRequest('/dashboard') as never);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://beta.checklyra.com/dashboard');
  });

  test('preserves the query string on the beta redirect', async () => {
    process.env.BETA_ROUTING_ENABLED = 'true';
    const res = await middleware(makeRequest('/search', '?q=ada') as never);
    expect(res.headers.get('location')).toBe('https://beta.checklyra.com/search?q=ada');
  });

  test('flag off → no beta redirect (passes through)', async () => {
    // BETA_ROUTING_ENABLED unset
    const res = await middleware(makeRequest('/dashboard') as never);
    const loc = res.headers.get('location');
    expect(loc === null || !loc.includes('beta.checklyra.com')).toBe(true);
  });

  test('exempt path /auth/* is never bounced to beta', async () => {
    process.env.BETA_ROUTING_ENABLED = 'true';
    const res = await middleware(makeRequest('/auth/callback', '?code=x') as never);
    const loc = res.headers.get('location');
    expect(loc === null || !loc.includes('beta.checklyra.com')).toBe(true);
  });

  test('exempt path /api/* is never bounced to beta', async () => {
    process.env.BETA_ROUTING_ENABLED = 'true';
    const res = await middleware(makeRequest('/api/something') as never);
    const loc = res.headers.get('location');
    expect(loc === null || !loc.includes('beta.checklyra.com')).toBe(true);
  });

  test('non-approved user is unaffected by beta routing', async () => {
    process.env.BETA_ROUTING_ENABLED = 'true';
    profileMaybeSingleMock.mockResolvedValue({ data: { beta_access_status: 'requested', is_beta_eligible: false } });
    const res = await middleware(makeRequest('/dashboard') as never);
    const loc = res.headers.get('location');
    expect(loc === null || !loc.includes('beta.checklyra.com')).toBe(true);
  });

  test('on the beta deploy itself, approved users are NOT bounced to beta', async () => {
    process.env.BETA_ROUTING_ENABLED = 'true';
    process.env.IS_BETA_DEPLOY = 'true';
    const res = await middleware(makeRequest('/dashboard') as never);
    const loc = res.headers.get('location');
    expect(loc === null || !loc.includes('beta.checklyra.com')).toBe(true);
  });
});
