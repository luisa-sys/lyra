/**
 * SEC-62 (web-oauth-4) — shared, cross-instance rate limiting for the OAuth
 * endpoints.
 *
 * Covers:
 *   1. sharedRateLimit() uses the Supabase `rate_limit_hit` RPC when the store
 *      is reachable (env present + RPC ok) and reports its verdict verbatim.
 *   2. sharedRateLimit() FAILS OPEN to the in-memory limiter on any store
 *      failure (missing env, RPC error, malformed row) — never fails closed —
 *      and still enforces a per-instance cap.
 *   3. clientIpFromHeaders() proxy-header precedence.
 *   4. /oauth/token + /oauth/revoke enforce a per-IP 429 cap (via the in-memory
 *      fallback path exercised in unit tests, since there is no Supabase env).
 */

// Configurable mock for the Supabase client so we can drive the RPC result.
let mockRpc: jest.Mock;
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ rpc: (...args: unknown[]) => mockRpc(...args) })),
}));

import { sharedRateLimit, clientIpFromHeaders } from '@/lib/rate-limit-shared';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { POST as TOKEN_POST } from '@/app/oauth/token/route';
import { POST as REVOKE_POST } from '@/app/oauth/revoke/route';

const SUPA_ENV_KEYS = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  mockRpc = jest.fn();
  for (const k of SUPA_ENV_KEYS) savedEnv[k] = process.env[k];
});

afterEach(() => {
  for (const k of SUPA_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

function withSupabaseEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
}

function clearSupabaseEnv() {
  for (const k of SUPA_ENV_KEYS) delete process.env[k];
}

describe('sharedRateLimit() — shared-store path', () => {
  test('calls rate_limit_hit with the bucket/limit/window and returns its verdict', async () => {
    withSupabaseEnv();
    mockRpc.mockResolvedValue({ data: [{ limited: true, retry_after: 42 }], error: null });

    const res = await sharedRateLimit('unit:key:a', { limit: 5, windowSeconds: 60 });

    expect(res).toEqual({ limited: true, retryAfter: 42, degraded: false });
    expect(mockRpc).toHaveBeenCalledWith('rate_limit_hit', {
      p_bucket: 'unit:key:a',
      p_limit: 5,
      p_window_seconds: 60,
    });
  });

  test('passes through an under-cap verdict', async () => {
    withSupabaseEnv();
    mockRpc.mockResolvedValue({ data: [{ limited: false, retry_after: 0 }], error: null });

    const res = await sharedRateLimit('unit:key:b', { limit: 5, windowSeconds: 60 });
    expect(res.limited).toBe(false);
    expect(res.degraded).toBe(false);
  });
});

describe('sharedRateLimit() — fail-open fallback', () => {
  test('falls back to the in-memory limiter when the service-role env is missing', async () => {
    clearSupabaseEnv();
    const cfg = { limit: 3, windowSeconds: 60 };
    const key = 'unit:fallback:missing-env';

    const verdicts = [];
    for (let i = 0; i < 4; i++) verdicts.push(await sharedRateLimit(key, cfg));

    // First 3 within the cap, 4th trips it — enforced by the in-memory backstop.
    expect(verdicts.slice(0, 3).every((v) => v.limited === false)).toBe(true);
    expect(verdicts[3].limited).toBe(true);
    // Every verdict is flagged degraded (store was never reached).
    expect(verdicts.every((v) => v.degraded === true)).toBe(true);
    // The RPC was never attempted (env threw before createClient).
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('falls back when the RPC returns an error', async () => {
    withSupabaseEnv();
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const res = await sharedRateLimit('unit:fallback:rpc-error', { limit: 3, windowSeconds: 60 });
    expect(res.degraded).toBe(true);
    expect(res.limited).toBe(false); // first hit under cap
  });

  test('falls back when the RPC returns no usable row', async () => {
    withSupabaseEnv();
    mockRpc.mockResolvedValue({ data: [], error: null });

    const res = await sharedRateLimit('unit:fallback:empty-row', { limit: 3, windowSeconds: 60 });
    expect(res.degraded).toBe(true);
  });
});

describe('clientIpFromHeaders()', () => {
  test('prefers cf-connecting-ip', () => {
    const h = new Headers({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' });
    expect(clientIpFromHeaders(h)).toBe('1.1.1.1');
  });

  test('uses the first x-forwarded-for hop when cf header is absent', () => {
    const h = new Headers({ 'x-forwarded-for': '3.3.3.3, 4.4.4.4' });
    expect(clientIpFromHeaders(h)).toBe('3.3.3.3');
  });

  test('falls back to "unknown" with no proxy headers', () => {
    expect(clientIpFromHeaders(new Headers())).toBe('unknown');
  });
});

describe('/oauth/token per-IP rate limit (SEC-62)', () => {
  test('returns 429 with Retry-After once the per-IP cap is exceeded', async () => {
    clearSupabaseEnv(); // exercise the in-memory fallback deterministically
    const ip = '198.51.100.20'; // unique bucket for this test
    const fire = () => {
      const req = new Request('https://dev.checklyra.com/oauth/token', {
        method: 'POST',
        headers: { 'x-forwarded-for': ip }, // no content-type → body parse fails AFTER the IP gate
        body: 'grant_type=refresh_token',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return TOKEN_POST(req as any);
    };

    for (let i = 0; i < RATE_LIMITS.oauthTokenIp.limit; i++) {
      const res = await fire();
      expect(res.status).not.toBe(429);
    }
    const limited = await fire();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
    const j = await limited.json();
    expect(j.error).toBe('too_many_requests');
  });
});

describe('/oauth/revoke per-IP rate limit (SEC-62)', () => {
  test('returns 429 with Retry-After once the per-IP cap is exceeded', async () => {
    clearSupabaseEnv();
    const ip = '198.51.100.21';
    const fire = () => {
      const req = new Request('https://dev.checklyra.com/oauth/revoke', {
        method: 'POST',
        headers: { 'x-forwarded-for': ip }, // no content-type → invalid_request AFTER the IP gate
        body: 'token=abc',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return REVOKE_POST(req as any);
    };

    for (let i = 0; i < RATE_LIMITS.oauthRevokeIp.limit; i++) {
      const res = await fire();
      expect(res.status).not.toBe(429);
    }
    const limited = await fire();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
    const j = await limited.json();
    expect(j.error).toBe('too_many_requests');
  });
});
