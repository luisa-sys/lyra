/**
 * KAN-414 F4 (KAN-417 §8 group 3) — behavioural replacement for the
 * `auth/callback continues to handle the next query param` scan in
 * tests/unit/forgot-reset-password.test.ts.
 *
 * WHY: THE ROUTE HAD NO EXECUTING TEST AT ALL
 * -------------------------------------------
 * `src/app/auth/callback/route.ts` is the OAuth (PKCE) entry point — 32 lines
 * that nothing imported before this file. Verified: `grep -rn "from
 * '@/app/auth/callback" tests/` returned only the path manifest.
 *
 * The scan asserts two literals, `searchParams.get('next')` and
 * `exchangeCodeForSession`, which prove the characters are present, not that
 * the value flows anywhere.
 *
 * WHAT IS *NOT* CLAIMED HERE
 * --------------------------
 * The open-redirect defence is **already well covered** and is not repeated:
 * `tests/unit/beta-access-flow.test.ts:95-99` drives `betaRedirectUrl` with
 * `//evil.com`, `https://evil.com`, `@evil.com`, `/\evil.com` and `/\/evil.com`
 * (SEC-07, SEC-19/F-12). This file asserts only that the route hands `next`
 * to that guard rather than around it — the wiring, not the guard.
 *
 * THE INVARIANTS, IN WORDS
 * ------------------------
 *  1. `?next=` is read and passed through. The password-recovery flow depends
 *     on it: `resetPasswordForEmail` sets `redirectTo=…?next=/reset-password`,
 *     so a route that ignored `next` would silently land every recovering user
 *     on the dashboard instead of the reset form — a broken flow that still
 *     looks like a successful sign-in.
 *  2. With no `next`, the default is `/dashboard`.
 *  3. A FAILED code exchange must not redirect as though sign-in succeeded.
 *  4. A request with no `code` at all does not attempt an exchange.
 *
 * MUTATION PROOF (2026-08-02, each reverted):
 *
 *   | mutation to the route                          | this suite | old scan |
 *   |------------------------------------------------|------------|----------|
 *   | hardcode `const next = '/dashboard'`           | 2 failed   | 1 failed |
 *   | redirect onward even when the exchange errors   | 1 failed   | 17 PASS  |
 *
 * Row 1 the scan CATCHES — hardcoding removes the very literal it greps for.
 * Recorded rather than glossed: my first draft of this comment claimed it
 * stayed green, and it does not.
 *
 * Row 2 is the one that justifies this file, and it is the more dangerous of
 * the two: a failed PKCE exchange that still routes onward sends an
 * unauthenticated visitor into the app shell. The scan asserts
 * `exchangeCodeForSession` appears; it says nothing about what happens when it
 * fails. That plus the route having had NO executing test at all is the value
 * here — not a claim that the scan is blind to everything.
 */
const exchangeCodeForSession = jest.fn(async () => ({ error: null as unknown }));

jest.mock('@/modules/platform/supabase-server', () => ({
  createClient: jest.fn(async () => ({ auth: { exchangeCodeForSession } })),
}));

const resolvePostLoginRedirect = jest.fn(
  async (_c: unknown, origin: string, next: string) => `${origin}${next}`,
);

jest.mock('@/modules/auth/post-login-redirect', () => ({
  resolvePostLoginRedirect: (...a: unknown[]) =>
    (resolvePostLoginRedirect as unknown as (...x: unknown[]) => unknown)(...a),
}));

import { GET } from '@/app/auth/callback/route';

const ORIGIN = 'https://checklyra.com';

function req(query: string) {
  return new Request(`${ORIGIN}/auth/callback${query}`);
}

beforeEach(() => {
  jest.clearAllMocks();
  exchangeCodeForSession.mockResolvedValue({ error: null });
});

describe('auth/callback route (behavioural, KAN-414 F4)', () => {
  it('passes ?next through to the post-login resolver', async () => {
    // The recovery flow's whole shape: redirectTo carries ?next=/reset-password.
    await GET(req('?code=abc&next=%2Freset-password'));

    expect(resolvePostLoginRedirect).toHaveBeenCalledWith(
      expect.anything(),
      ORIGIN,
      '/reset-password',
    );
  });

  it('defaults to /dashboard when no next is supplied', async () => {
    await GET(req('?code=abc'));

    expect(resolvePostLoginRedirect).toHaveBeenCalledWith(
      expect.anything(),
      ORIGIN,
      '/dashboard',
    );
  });

  it('hands a hostile next to the resolver rather than around it', async () => {
    // The rejection itself is betaRedirectUrl's job and is tested there
    // (beta-access-flow.test.ts:95-99). What matters here is that the route
    // does not bypass it — e.g. by redirecting to `next` directly.
    const res = await GET(req('?code=abc&next=%2F%2Fevil.test'));

    expect(resolvePostLoginRedirect).toHaveBeenCalledWith(
      expect.anything(),
      ORIGIN,
      '//evil.test',
    );
    expect(res.headers.get('location') ?? '').not.toMatch(/^https?:\/\/evil\.test/);
  });

  it('does NOT redirect as signed-in when the code exchange fails', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: 'bad code' } });

    const res = await GET(req('?code=stale&next=%2Fdashboard'));

    // A failed exchange that still routed onward would send an unauthenticated
    // visitor into the app shell.
    expect(resolvePostLoginRedirect).not.toHaveBeenCalled();
    expect(res.headers.get('location') ?? '').toMatch(/error/i);
  });

  it('does not attempt an exchange when there is no code', async () => {
    const res = await GET(req('?next=%2Fdashboard'));

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(resolvePostLoginRedirect).not.toHaveBeenCalled();
    expect(res.headers.get('location') ?? '').toMatch(/error/i);
  });
});
