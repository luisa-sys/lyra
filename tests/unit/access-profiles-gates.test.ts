/**
 * The two profiles gates, per-gate — KAN-415 D4 C6.
 *
 * middleware-gate-order.test.ts asserts them through the real middleware, which
 * is the authority. This file adds what only a per-gate test can: each gate's
 * exact column list, so a future attempt to merge the two queries shows up as a
 * gate selecting columns it does not own, rather than as a silent single read.
 *
 * D4 constraint 6 forbids merging them — the second read is conditional on the
 * first not redirecting — and this is the tripwire for it at the unit level.
 */
import { NextRequest, NextResponse } from 'next/server';
import type { AuthedContext } from '@/modules/access/context';
import { betaTier } from '@/modules/access/gates/beta-tier';
import { suspension } from '@/modules/access/gates/suspension';

const selected: string[] = [];

function ctx(
  pathname: string,
  {
    user = { id: 'u1' } as { id: string } | null,
    row = null as Record<string, unknown> | null,
    error = null as { message: string } | null,
    deployTier = 'beta' as 'beta' | 'prod' | null,
  } = {},
): AuthedContext {
  const request = new NextRequest(new URL(`https://checklyra.com${pathname}`), {
    headers: { host: 'checklyra.com' },
  });
  return {
    request,
    pathname,
    env: {
      isBetaDeploy: deployTier === 'beta',
      deployTier,
      adminHost: 'admin.checklyra.com',
      adminHostEnforced: false,
    },
    csp: () => 'csp',
    user,
    res: { current: NextResponse.next() },
    supabase: {
      from: () => ({
        select: (cols: string) => {
          selected.push(cols);
          return { eq: () => ({ maybeSingle: async () => ({ data: row, error }) }) };
        },
      }),
    },
  } as unknown as AuthedContext;
}

beforeEach(() => {
  selected.length = 0;
});

describe('each gate selects ONLY its own columns', () => {
  test('suspension reads is_suspended and nothing else', async () => {
    await suspension.run(ctx('/dashboard', { row: { is_suspended: false } }));
    expect(selected).toEqual(['is_suspended']);
  });

  test('beta-tier reads user_status and access_tier, and not is_suspended', async () => {
    await betaTier.run(ctx('/dashboard', { row: { user_status: 'live', access_tier: 'beta' } }));
    expect(selected).toEqual(['user_status, access_tier']);
    expect(selected[0]).not.toContain('is_suspended');
  });
});

describe('suspension', () => {
  test('redirects a suspended user to /suspended', async () => {
    const out = await suspension.run(ctx('/dashboard', { row: { is_suspended: true } }));
    expect(new URL(out!.headers.get('location')!).pathname).toBe('/suspended');
  });

  test('an exempt path is not even read — the query is skipped entirely', async () => {
    // The exemption check moved INSIDE the user guard in C6. Unobservable in
    // behaviour, but it means an exempt request costs no database read, which
    // is where the real per-request saving is.
    const out = await suspension.run(ctx('/login', { row: { is_suspended: true } }));
    expect(out).toBeNull();
    expect(selected).toEqual([]);
  });

  test('an anonymous request costs no read', async () => {
    await suspension.run(ctx('/dashboard', { user: null }));
    expect(selected).toEqual([]);
  });

  test('a lookup ERROR fails OPEN and says so — two args, "failing open"', async () => {
    // The signature is pinned by middleware-gate-order.test.ts too. Reformatting
    // it into one interpolated string breaks a test that exists because a
    // silent fail-open is indistinguishable from no gate at all.
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const out = await suspension.run(ctx('/dashboard', { error: { message: 'boom' } }));
    expect(out).toBeNull();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('failing open'), 'boom');
    spy.mockRestore();
  });
});

describe('beta-tier', () => {
  test('a non-live user goes to /waitlist', async () => {
    const out = await betaTier.run(ctx('/dashboard', { row: { user_status: 'pending', access_tier: 'beta' } }));
    expect(new URL(out!.headers.get('location')!).pathname).toBe('/waitlist');
  });

  test('a live user on the wrong tier is sent to their own host, keeping the path', async () => {
    const out = await betaTier.run(
      ctx('/dashboard/profile', { row: { user_status: 'live', access_tier: 'prod' } }),
    );
    const url = new URL(out!.headers.get('location')!);
    expect(url.host).toBe('checklyra.com');
    expect(url.pathname).toBe('/dashboard/profile');
  });

  test('deployTier null means the gate is inert — dev and staging are not tier-gated', async () => {
    const out = await betaTier.run(ctx('/dashboard', { deployTier: null, row: { user_status: 'pending', access_tier: 'beta' } }));
    expect(out).toBeNull();
    expect(selected).toEqual([]);
  });

  test('a lookup ERROR fails CLOSED and says so — the 2026-08-09 decision', async () => {
    // Direction unchanged (still /waitlist); the silence is what changed.
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const out = await betaTier.run(ctx('/dashboard', { error: { message: 'boom' } }));
    expect(new URL(out!.headers.get('location')!).pathname).toBe('/waitlist');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('failing closed'), 'boom');
    spy.mockRestore();
  });

  test('an ordinary not-live user logs nothing', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await betaTier.run(ctx('/dashboard', { row: { user_status: 'pending', access_tier: 'beta' } }));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
