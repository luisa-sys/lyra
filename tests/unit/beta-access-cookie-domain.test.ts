/**
 * KAN-274 — cross-domain cookie scoping in src/lib/supabase-server.ts.
 *
 * We mock @supabase/ssr's createServerClient to capture the `cookies` adapter
 * it's handed, then drive that adapter's setAll() with a representative
 * Supabase auth cookie (carrying Secure + SameSite=Lax) and assert:
 *   - COOKIE_DOMAIN set   → every cookie gets `domain` added, Secure/SameSite kept.
 *   - COOKIE_DOMAIN unset → options passed through untouched (no domain key).
 */

const setCalls: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];

jest.mock('next/headers', () => ({
  cookies: jest.fn(async () => ({
    getAll: () => [],
    set: (name: string, value: string, options: Record<string, unknown>) => {
      setCalls.push({ name, value, options });
    },
  })),
}));

let capturedCookies: {
  setAll: (
    list: Array<{ name: string; value: string; options: Record<string, unknown> }>
  ) => void;
} | null = null;

jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn((_url: string, _key: string, opts: { cookies: typeof capturedCookies }) => {
    capturedCookies = opts.cookies;
    return {};
  }),
}));

jest.mock('@/lib/env', () => {
  const actual = jest.requireActual('@/lib/env');
  return { env: actual.env };
});

import { createClient } from '@/lib/supabase-server';

const SAMPLE_COOKIE = {
  name: 'sb-access-token',
  value: 'abc',
  options: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as Record<string, unknown>,
};

describe('KAN-274 supabase-server cookie domain', () => {
  const ORIGINAL = process.env.COOKIE_DOMAIN;

  beforeEach(() => {
    setCalls.length = 0;
    capturedCookies = null;
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.COOKIE_DOMAIN;
    else process.env.COOKIE_DOMAIN = ORIGINAL;
  });

  test('adds domain to every cookie when COOKIE_DOMAIN is set, preserving Secure + SameSite', async () => {
    process.env.COOKIE_DOMAIN = '.checklyra.com';
    await createClient();
    expect(capturedCookies).not.toBeNull();

    capturedCookies!.setAll([{ ...SAMPLE_COOKIE, options: { ...SAMPLE_COOKIE.options } }]);

    expect(setCalls).toHaveLength(1);
    expect(setCalls[0].options.domain).toBe('.checklyra.com');
    expect(setCalls[0].options.secure).toBe(true);
    expect(setCalls[0].options.sameSite).toBe('lax');
  });

  test('leaves options untouched (no domain) when COOKIE_DOMAIN is unset', async () => {
    delete process.env.COOKIE_DOMAIN;
    await createClient();

    capturedCookies!.setAll([{ ...SAMPLE_COOKIE, options: { ...SAMPLE_COOKIE.options } }]);

    expect(setCalls).toHaveLength(1);
    expect('domain' in setCalls[0].options).toBe(false);
    expect(setCalls[0].options.secure).toBe(true);
    expect(setCalls[0].options.sameSite).toBe('lax');
  });
});
