/**
 * middleware.ts — gate ORDER and the fail-open/fail-closed asymmetry.
 * KAN-415 D4 prerequisite.
 *
 * WHY THIS EXISTS
 * ---------------
 * The modularisation plan says D4 (extract `access`, decompose middleware.ts
 * into a named gate pipeline) "ships alone", and gives the reason: **the order
 * of the gates and the fail-open/fail-closed asymmetry are behavioural
 * contracts with no current unit test.**
 *
 * That is exactly right, and it is why these tests come BEFORE the refactor
 * rather than after it. middleware.ts runs on every request and decides who is
 * authenticated, who is suspended, who reaches /admin and who is bounced to
 * /waitlist. Reordering two `if` blocks during a decomposition changes all of
 * that silently — every existing test still passes, because each one exercises
 * a single gate in isolation and none of them pins the SEQUENCE.
 *
 * These are CHARACTERISATION tests. They record what the middleware does
 * today, including the parts that look surprising, so that a later refactor
 * has something to be equivalent TO. Where current behaviour is arguably
 * wrong, that is called out in a comment rather than "fixed" here — changing
 * behaviour and proving behaviour unchanged are different jobs, and doing both
 * at once means neither is verifiable.
 *
 * The tests import the REAL middleware and mock only its outermost
 * dependencies (@supabase/ssr and the two guards that reach the network or a
 * shared store). Nothing here re-implements a gate — CTL-038's failure mode is
 * a test suite that reports on a copy of its subject.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

let mockUser: { id: string } | null = { id: 'user-1' };
let mockSuspended: boolean | null = false;
let mockSuspensionError: { message: string } | null = null;
let mockProfile: { user_status: string; access_tier: string } | null = null;
let mockProfileError: { message: string } | null = null;

/** Every profiles read the middleware makes, in order, so ORDER is observable. */
let profileReads: string[] = [];

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: mockUser } }) },
    from: (table: string) => ({
      select: (cols: string) => {
        profileReads.push(`${table}:${cols}`);
        return {
          eq: () => ({
            maybeSingle: async () => {
              // The middleware distinguishes its two profiles reads by the
              // columns it asks for, which is also how we tell them apart.
              if (cols.includes('is_suspended')) {
                return {
                  data: mockSuspensionError ? null : { is_suspended: mockSuspended },
                  error: mockSuspensionError,
                };
              }
              return {
                data: mockProfileError ? null : mockProfile,
                error: mockProfileError,
              };
            },
          }),
        };
      },
    }),
  }),
}));

let mockLimited = false;
jest.mock('@/modules/guards/rate-limit', () => ({
  RATE_LIMITS: { auth: { windowMs: 1000, max: 5 } },
  rateLimit: () => ({ limited: mockLimited, retryAfter: 42 }),
}));

let mockCfEnabled = false;
let mockCfValid = true;
jest.mock('@/modules/guards/cf-access', () => ({
  cfAccessEnabled: () => mockCfEnabled,
  verifyCfAccessToken: async () => mockCfValid,
}));

import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

function req(
  path: string,
  { method = 'GET', host = 'checklyra.com' }: { method?: string; host?: string } = {},
): NextRequest {
  return new NextRequest(new URL(`https://${host}${path}`), {
    method,
    headers: { host },
  });
}

const loc = (res: Response) => {
  const l = res.headers.get('location');
  return l ? new URL(l) : null;
};

beforeEach(() => {
  mockUser = { id: 'user-1' };
  mockSuspended = false;
  mockSuspensionError = null;
  mockProfile = { user_status: 'live', access_tier: 'prod' };
  mockProfileError = null;
  mockLimited = false;
  mockCfEnabled = false;
  mockCfValid = true;
  profileReads = [];
  delete process.env.IS_BETA_DEPLOY;
  delete process.env.ADMIN_HOST_ENFORCED;
  delete process.env.VERCEL_ENV;
  delete process.env.NEXT_PUBLIC_SITE_URL;
  jest.restoreAllMocks();
});

describe('gate ORDER — which gate wins when two apply at once', () => {
  /**
   * Each of these puts a request in a state where TWO gates would fire, and
   * pins which one actually does. That is the only way order is observable
   * from the outside, and it is precisely what a decomposition can break while
   * every single-gate test stays green.
   */

  test('SEC-36 beta OAuth 404 beats the SUSPENSION gate', async () => {
    // Written this way after the first attempt turned out to be VACUOUS. It
    // originally paired SEC-36 against the auth rate limiter — but the rate
    // limiter only fires on /login, /signup and /auth/*, and isOauthServerPath
    // matches /oauth/*, /.well-known/* and /api/well-known/*. Those sets are
    // DISJOINT, so no request reaches both gates, the ordering between them is
    // unobservable, and the test could not fail. Proven by moving SEC-36 below
    // the rate limiter: all 29 tests stayed green.
    //
    // The suspension gate DOES collide with it — a suspended user hitting an
    // OAuth path reaches both — so this ordering is real and observable.
    // It also matters: SEC-36 exists to close an unauthenticated DCR write into
    // PRODUCTION's oauth_clients (beta runs on the prod Supabase project,
    // gotcha #19), so it must not depend on auth state at all. A 404 that
    // becomes a /suspended redirect is a 404 that has started answering
    // questions about who you are.
    process.env.IS_BETA_DEPLOY = 'true';
    mockSuspended = true;
    const res = await middleware(req('/oauth/register', { method: 'POST' }));
    expect(res.status).toBe(404);
    expect(loc(res)).toBeNull();
    // And it never looked the user up, because it returned before any DB work.
    expect(profileReads).toEqual([]);
  });

  test('SEC-36 beta OAuth 404 beats authentication entirely', async () => {
    // No Supabase round-trip should be needed to refuse an endpoint that does
    // not exist on this deploy.
    process.env.IS_BETA_DEPLOY = 'true';
    mockUser = null;
    const res = await middleware(req('/.well-known/jwks.json'));
    expect(res.status).toBe(404);
    expect(profileReads).toEqual([]);
  });

  test('the suspension gate beats the beta/tier gate', async () => {
    // Ordering is documented in the source: "Runs before the beta gate so a
    // suspended user lands on /suspended, not /waitlist." Both gates fire for
    // this request; only the first one may win.
    process.env.IS_BETA_DEPLOY = 'true';
    mockSuspended = true;
    mockProfile = { user_status: 'pending', access_tier: 'beta' }; // would send to /waitlist
    const res = await middleware(req('/dashboard'));
    expect(loc(res)?.pathname).toBe('/suspended');
  });

  test('the admin-host branch returns EARLY, skipping the beta gate', async () => {
    // Source: "Already an /admin path (or passthrough) — serve it, and
    // crucially skip the beta gate below so an admin isn't bounced to
    // /waitlist." An admin whose own profile is not `live` must still reach
    // the admin console, or enabling the beta gate locks out the operator.
    process.env.ADMIN_HOST_ENFORCED = 'true';
    process.env.IS_BETA_DEPLOY = 'true';
    mockProfile = { user_status: 'pending', access_tier: 'beta' };
    const res = await middleware(req('/admin/users', { host: 'admin.checklyra.com' }));
    expect(loc(res)).toBeNull(); // NOT redirected to /waitlist
    // And it never even asks — the early return is above the beta gate's read.
    expect(profileReads.some((r) => r.includes('user_status'))).toBe(false);
  });

  test('SEC-121 — the admin-host early return CURRENTLY skips the suspension gate (documented gap)', async () => {
    // This test records what the middleware does TODAY on the admin host
    // while SEC-121's ordering fix waits on the exact-order assertion
    // sign-off (see the SEC-121 note on AUTHED_ORDER in pipeline.ts). The
    // request is a suspended user hitting /admin/users on admin.checklyra.com
    // — on checklyra.com the same request bounces to /suspended, on the
    // admin host the middleware lets it through because admin-host RETURNS
    // before the suspension gate runs.
    //
    // A DELIBERATE red-when-fixed test — when Luisa signs off on moving
    // `suspension` above `admin-host`, this expectation flips to
    // `/suspended` (see the parallel SEC-121 test in admin.test.ts pinning
    // the durable second layer). Kept because it records the state the
    // reorder is meant to change, and because it forces the reorder PR to
    // update this file (not silently landing).
    process.env.ADMIN_HOST_ENFORCED = 'true';
    mockSuspended = true;
    const res = await middleware(req('/admin/users', { host: 'admin.checklyra.com' }));
    expect(loc(res)).toBeNull();
    // No suspension read either — the gate never ran. On checklyra.com this
    // would be `['profiles:is_suspended']`.
    expect(profileReads).toEqual([]);
  });

  test('the PKCE code redirect beats the beta/tier gate', async () => {
    // Also rewritten: the original paired this against the rate limiter, which
    // never fires on '/', so the assertion was unobservable for the same reason
    // as the SEC-36 case above.
    //
    // The beta gate DOES apply to '/', so this ordering is real — and it is the
    // one that matters. A user completing a PKCE exchange has a `code` but no
    // session yet; bounce them to /waitlist before /auth/callback runs and the
    // session is never established, so they can never become 'live' and never
    // stop being bounced. That is a login loop, not a redirect.
    process.env.IS_BETA_DEPLOY = 'true';
    mockProfile = { user_status: 'pending', access_tier: 'beta' };
    const res = await middleware(new NextRequest(new URL('https://checklyra.com/?code=abc'), {
      headers: { host: 'checklyra.com' },
    }));
    expect(loc(res)?.pathname).toBe('/auth/callback');
  });
});

describe('fail-OPEN paths — deliberate, and each one load-bearing', () => {
  test('missing Supabase env skips EVERY auth gate', async () => {
    // The single widest fail-open in the file: no env -> next(), so
    // suspension, the beta gate and the /dashboard redirect are all skipped.
    // Correct for local/CI boots that have no Supabase, but it means the
    // security posture of this middleware is exactly as strong as the presence
    // of two environment variables. Pinned so a decomposition cannot widen it
    // (e.g. by leaving it in place while moving a gate ABOVE the env check,
    // which would then run without a client).
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    try {
      mockUser = null;
      const res = await middleware(req('/dashboard'));
      expect(loc(res)).toBeNull(); // an anonymous user reaches /dashboard
      expect(profileReads).toEqual([]);
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = url;
    }
  });

  test('a suspension lookup ERROR fails open, and says so out loud', async () => {
    // Deliberate, with the reasoning in the source: a suspended user's public
    // exposure is already prevented by RLS, so this gate governs only their own
    // session — and failing closed on a transient read error would lock out the
    // entire authenticated userbase. The console.error is part of the contract,
    // not decoration: silent fail-open is indistinguishable from no gate.
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockSuspensionError = { message: 'connection reset' };
    const res = await middleware(req('/dashboard'));
    expect(loc(res)).toBeNull();
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('failing open'),
      'connection reset',
    );
  });

  test('a MISSING profile row does not suspend anyone', async () => {
    mockSuspended = null; // maybeSingle() -> no row
    const res = await middleware(req('/dashboard'));
    expect(loc(res)).toBeNull();
  });
});

describe('fail-CLOSED paths — the other half of the asymmetry', () => {
  test('an invalid Cloudflare Access JWT is 403, not a redirect', async () => {
    mockCfEnabled = true;
    mockCfValid = false;
    const res = await middleware(req('/admin/users', { host: 'admin.checklyra.com' }));
    expect(res.status).toBe(403);
  });

  test('a MISSING profile row DOES bounce you to /waitlist', async () => {
    // The asymmetry, in one pair of tests. Same absent row, opposite outcome:
    // the suspension gate reads `suspProfile?.is_suspended` (absent -> falsy ->
    // proceed), the beta gate reads `profile?.user_status !== 'live'` (absent ->
    // not 'live' -> redirect). Both are defensible on their own terms, and the
    // combination is the thing D4 has to preserve deliberately rather than
    // reproduce by accident.
    process.env.IS_BETA_DEPLOY = 'true';
    mockProfile = null;
    const res = await middleware(req('/dashboard'));
    expect(loc(res)?.pathname).toBe('/waitlist');
  });

  /**
   * ⚠️ THIS WAS A DEFECT. IT IS NOW A DECISION.
   *
   * The beta/tier gate destructured only `{ data: profile }` and never looked
   * at `error`. A transient profiles-read failure made `profile` undefined,
   * which is `!== 'live'`, which redirected a LEGITIMATE LIVE USER to /waitlist
   * — silently. No log, no signal, and no way for that user to self-recover:
   * they ARE live, they just cannot prove it while the read is failing.
   *
   * The suspension gate fifty lines above was explicitly hardened against
   * exactly this ("never fail silently on a lookup error") and fails OPEN with
   * a console.error. Same read, opposite direction, no log.
   *
   * DECIDED 2026-08-09 (Luisa): FAIL CLOSED, BUT LOGGED.
   *
   * The direction stays — this gate governs access to a gated product, whereas
   * suspension governs a suspended user's own session, and admitting an
   * unverified user to beta on a transient database error is the worse outcome.
   * What changes is the silence.
   *
   * This assertion previously read `expect(spy).not.toHaveBeenCalled()`, with a
   * comment saying that if a future change started logging here the test would
   * fail and someone would read the note. That is exactly what happened, in the
   * commit that made the change. Updated deliberately, not to make a build
   * green.
   */
  test('a beta-gate query ERROR fails closed to /waitlist, and SAYS SO', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env.IS_BETA_DEPLOY = 'true';
    mockProfileError = { message: 'connection reset' };
    const res = await middleware(req('/dashboard'));
    // The direction is unchanged: still closed, still /waitlist.
    expect(loc(res)?.pathname).toBe('/waitlist');
    // The silence is not. And it must be DISTINGUISHABLE from the ordinary
    // not-live case, or the log cannot answer "was this user actually live?".
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('failing closed'),
      'connection reset',
    );
  });

  test('an ordinary not-live user is NOT logged as an error', async () => {
    // The other half. If every /waitlist bounce logged, the log would be noise
    // and the error case would be invisible inside it — which is the same
    // failure as not logging at all, arrived at from the other direction.
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env.IS_BETA_DEPLOY = 'true';
    mockProfile = { user_status: 'pending', access_tier: 'beta' };
    const res = await middleware(req('/dashboard'));
    expect(loc(res)?.pathname).toBe('/waitlist');
    expect(spy).not.toHaveBeenCalled();
  });});

describe('exemption tables — the loops they exist to prevent', () => {
  // Two overlapping inline exemption arrays today; D4 replaces them with one
  // declarative table. These pin the union of what must stay exempt, so the
  // consolidation is checkable rather than eyeballed.
  test.each(['/suspended', '/login', '/auth/callback', '/favicon.ico'])(
    'suspended user is not redirected from %s (no loop)',
    async (path) => {
      mockSuspended = true;
      const res = await middleware(req(path));
      expect(loc(res)?.pathname === '/suspended').toBe(false);
    },
  );

  test.each(['/waitlist', '/suspended', '/status', '/login', '/signup', '/join', '/confirm-age'])(
    'beta gate exempts %s',
    async (path) => {
      process.env.IS_BETA_DEPLOY = 'true';
      mockProfile = { user_status: 'pending', access_tier: 'beta' };
      const res = await middleware(req(path));
      expect(loc(res)?.pathname === '/waitlist').toBe(false);
    },
  );

  test('/status is never beta-gated (SEC-4) — the public status page', async () => {
    // Called out separately because it is the one exemption whose absence
    // would break external monitoring rather than a user journey.
    process.env.IS_BETA_DEPLOY = 'true';
    mockProfile = { user_status: 'pending', access_tier: 'beta' };
    const res = await middleware(req('/status'));
    expect(loc(res)).toBeNull();
  });
});

describe('the remaining redirects', () => {
  test('anonymous user on /dashboard goes to /login', async () => {
    mockUser = null;
    const res = await middleware(req('/dashboard'));
    expect(loc(res)?.pathname).toBe('/login');
  });

  test('authenticated user on /login goes to /dashboard', async () => {
    const res = await middleware(req('/login'));
    expect(loc(res)?.pathname).toBe('/dashboard');
  });

  test('a live user on the WRONG tier is sent to their own site, keeping the path', async () => {
    process.env.IS_BETA_DEPLOY = 'true';
    mockProfile = { user_status: 'live', access_tier: 'prod' };
    const res = await middleware(req('/dashboard/profile'));
    const l = loc(res);
    expect(l?.host).toBe('checklyra.com');
    expect(l?.pathname).toBe('/dashboard/profile');
  });

  test('/admin on a non-admin host redirects to the admin subdomain', async () => {
    process.env.ADMIN_HOST_ENFORCED = 'true';
    const res = await middleware(req('/admin/users'));
    expect(loc(res)?.host).toBe('admin.checklyra.com');
  });

  test('POST to /login is rate limited with a Retry-After', async () => {
    mockLimited = true;
    const res = await middleware(req('/login', { method: 'POST' }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
  });

  test('GET to /login is NOT rate limited — only form submissions are', async () => {
    mockLimited = true;
    const res = await middleware(req('/login'));
    expect(res.status).not.toBe(429);
  });
});
