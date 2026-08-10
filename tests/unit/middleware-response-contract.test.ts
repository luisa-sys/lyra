/**
 * middleware.ts — the response-level contracts the 29 gate-order tests cannot see.
 * KAN-415 D4, commit C1. Written against the CURRENT code, before anything moves.
 *
 * WHY A SECOND FILE RATHER THAN MORE OF THE FIRST
 * -----------------------------------------------
 * `middleware-gate-order.test.ts` pins WHICH GATE WINS. It does that well and is
 * mutation-proven. But it observes almost nothing about the response object
 * itself, and the D4 decomposition moves exactly the machinery that builds one:
 * the Supabase client's cookie plumbing, the CSP nonce, and the admin rewrite.
 *
 * Three gaps were measured before writing this, not assumed:
 *
 *   (a) `options.cookies.setAll` is invoked by ZERO of the 33 existing tests.
 *       Both existing mocks construct `createServerClient` as a ZERO-ARGUMENT
 *       factory — `createServerClient: () => ({...})` — so the options object
 *       carrying the cookie callbacks is discarded unread. The refreshed
 *       session cookie, and `withParentCookieDomain` on it, are therefore
 *       completely unguarded. That is the single most load-bearing thing D4
 *       relocates (C5 moves the client construction wholesale).
 *
 *   (b) No test reads a CSP header off a middleware response.
 *       `security-headers.test.ts` exercises `buildCspReportOnly` in isolation
 *       and reads next.config.ts. Whether a given EXIT stamps the header is
 *       unobserved — so a decomposition that stamped every response, or none,
 *       would be invisible.
 *
 *   (c) `admin-host-routing.test.ts` has 5 tests and asserts no passthrough
 *       path at all. The passthrough list (`/login`, `/auth/*`, `/api/*`,
 *       `/_next/*`) is the difference between an admin host that works and one
 *       that rewrites its own login page into `/admin/login`.
 *
 * And (d): the two sequential `profiles` reads, whose ORDER and CONDITIONALITY
 * are constraint 6 of the D4 brief — the second read must not happen when the
 * first redirects.
 *
 * These assert CURRENT behaviour. Where current behaviour is arguably wrong it
 * is pinned as-is with a comment, not corrected — this file exists so the
 * refactor has something to be equivalent TO.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

let mockUser: { id: string } | null = { id: 'user-1' };
let mockSuspended: boolean | null = false;
let mockProfile: { user_status: string; access_tier: string } | null = null;

/** Every profiles read, in order — the tripwire for constraint 6. */
let profileReads: string[] = [];
/** When true, the mock rotates the session inside getUser, as the real client does. */
let refreshOnGetUser = false;
const REFRESHED_COOKIE = 'sb-access-token';
/** Whatever the middleware handed createServerClient as its third argument. */
let capturedOptions: { cookies?: { getAll?: () => unknown; setAll?: (c: unknown[]) => void } } | null = null;

jest.mock('@supabase/ssr', () => ({
  // NOTE the arity. The existing mocks are `() => ({...})` and silently drop
  // this object, which is why setAll has never been exercised.
  createServerClient: (_url: string, _key: string, options: Record<string, never>) => {
    capturedOptions = options as typeof capturedOptions;
    return {
      auth: {
        getUser: async () => {
          // @supabase/ssr rotates the session DURING getUser and calls setAll
          // from inside it. Reproducing that timing is the whole point: the
          // middleware's callback rebuilds `supabaseResponse`, so anything that
          // captured the old instance returns a response without the new cookie.
          if (refreshOnGetUser) {
            (options as unknown as { cookies: { setAll: (c: unknown[]) => void } }).cookies.setAll([
              { name: REFRESHED_COOKIE, value: 'new-token', options: { path: '/' } },
            ]);
          }
          return { data: { user: mockUser } };
        },
      },
      from: (table: string) => ({
        select: (cols: string) => {
          profileReads.push(`${table}:${cols}`);
          return {
            eq: () => ({
              maybeSingle: async () =>
                cols.includes('is_suspended')
                  ? { data: { is_suspended: mockSuspended }, error: null }
                  : { data: mockProfile, error: null },
            }),
          };
        },
      }),
    };
  },
}));

jest.mock('@/modules/guards/rate-limit', () => ({
  RATE_LIMITS: { auth: { windowMs: 1000, max: 5 } },
  rateLimit: () => ({ limited: false, retryAfter: 0 }),
}));

let mockCfEnabled = false;
jest.mock('@/modules/guards/cf-access', () => ({
  cfAccessEnabled: () => mockCfEnabled,
  verifyCfAccessToken: async () => true,
}));

import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

const CSP_HEADER = 'Content-Security-Policy-Report-Only';

function req(
  path: string,
  { method = 'GET', host = 'checklyra.com' }: { method?: string; host?: string } = {},
): NextRequest {
  return new NextRequest(new URL(`https://${host}${path}`), { method, headers: { host } });
}

beforeEach(() => {
  mockUser = { id: 'user-1' };
  mockSuspended = false;
  mockProfile = { user_status: 'live', access_tier: 'prod' };
  mockCfEnabled = false;
  profileReads = [];
  capturedOptions = null;
  refreshOnGetUser = false;
  delete process.env.IS_BETA_DEPLOY;
  delete process.env.ADMIN_HOST_ENFORCED;
  delete process.env.VERCEL_ENV;
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

describe('(a) the cookie-refresh path — invoked by none of the existing 33 tests', () => {
  test('middleware supplies BOTH cookie callbacks to createServerClient', async () => {
    // The precondition for everything else here. If the options object stops
    // being passed, every assertion below passes vacuously — so assert the
    // shape before relying on it.
    await middleware(req('/dashboard'));
    expect(capturedOptions).not.toBeNull();
    expect(typeof capturedOptions?.cookies?.getAll).toBe('function');
    expect(typeof capturedOptions?.cookies?.setAll).toBe('function');
  });

  test('a session refreshed DURING getUser lands on the returned response', async () => {
    // The one that matters. @supabase/ssr rotates the session inside getUser
    // and calls setAll from there; the middleware's callback REBUILDS
    // supabaseResponse at that moment. Any refactor that captures the response
    // by value before this point returns one without the new cookie — and every
    // user gets logged out on token rotation, silently, with all 33 other tests
    // still green.
    refreshOnGetUser = true;
    const res = await middleware(req('/dashboard'));
    expect(res.cookies.get(REFRESHED_COOKIE)?.value).toBe('new-token');
  });

  test('the refreshed cookie also survives the ADMIN REWRITE exit', async () => {
    // A separate exit that rebuilds the response object from scratch and copies
    // cookies across by hand (`supabaseResponse.cookies.getAll().forEach`).
    // That hand-copy is exactly the kind of step a decomposition drops.
    process.env.ADMIN_HOST_ENFORCED = 'true';
    refreshOnGetUser = true;
    const res = await middleware(req('/users', { host: 'admin.checklyra.com' }));
    expect(res.headers.get('x-middleware-rewrite')).toBeTruthy();
    expect(res.cookies.get(REFRESHED_COOKIE)?.value).toBe('new-token');
  });

  test('no refresh means no stray cookie — the assertion above is not trivially true', async () => {
    refreshOnGetUser = false;
    const res = await middleware(req('/dashboard'));
    expect(res.cookies.get(REFRESHED_COOKIE)).toBeUndefined();
  });
});

describe('(b) which exits stamp the CSP header — a map, not a spot-check', () => {
  // Report-Only never blocks, so a missing header is invisible in production
  // until the SEC-63 follow-up flips it to enforcing. Then it is very visible.
  test('the terminal response carries the CSP header', async () => {
    const res = await middleware(req('/some-page'));
    expect(res.headers.get(CSP_HEADER)).toBeTruthy();
  });

  test('the env-missing fail-open response carries it too', async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    try {
      const res = await middleware(req('/some-page'));
      expect(res.headers.get(CSP_HEADER)).toBeTruthy();
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = url;
    }
  });

  test.each([
    ['SEC-36 404', '/oauth/register'],
  ])('%s does NOT carry a CSP header — it is not a document', async (_label, path) => {
    process.env.IS_BETA_DEPLOY = 'true';
    const res = await middleware(req(path));
    expect(res.headers.get(CSP_HEADER)).toBeNull();
  });

  test('a redirect does not carry a CSP header', async () => {
    mockUser = null;
    const res = await middleware(req('/dashboard'));
    expect(res.headers.get(CSP_HEADER)).toBeNull();
  });

  test('the SEC-36 404 path generates NO nonce — it returns before the CSP is built', async () => {
    // Cost, and evidence of ordering. The nonce costs a getRandomValues call on
    // every request that reaches it; the 404 must return first. If a
    // decomposition builds the context (and the nonce) eagerly at the top, this
    // is the test that notices.
    process.env.IS_BETA_DEPLOY = 'true';
    const spy = jest.spyOn(globalThis.crypto, 'getRandomValues');
    try {
      await middleware(req('/oauth/register'));
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('(c) admin-host passthrough is a SET, not two examples', () => {
  const onAdminHost = (p: string) => req(p, { host: 'admin.checklyra.com' });

  beforeEach(() => {
    process.env.ADMIN_HOST_ENFORCED = 'true';
  });

  test.each(['/login', '/auth/callback', '/api/health', '/_next/static/x.js'])(
    '%s is served unchanged on the admin host — rewriting it would break the console',
    async (path) => {
      const res = await middleware(onAdminHost(path));
      // Not rewritten into /admin/... and not redirected away.
      expect(res.headers.get('location')).toBeNull();
      expect(res.headers.get('x-middleware-rewrite') || '').not.toContain('/admin');
    },
  );

  test.each(['/users', '/favicon.ico', '/suspended'])(
    '%s IS rewritten under /admin on the admin host',
    async (path) => {
      const res = await middleware(onAdminHost(path));
      const rewrite = res.headers.get('x-middleware-rewrite');
      expect(rewrite).toBeTruthy();
      expect(new URL(rewrite as string).pathname).toBe(`/admin${path}`);
    },
  );

  test('the admin rewrite carries the CSP header — it serves a document', async () => {
    const res = await middleware(onAdminHost('/users'));
    expect(res.headers.get(CSP_HEADER)).toBeTruthy();
  });

  test('an already-/admin path is served, not rewritten again', async () => {
    const res = await middleware(onAdminHost('/admin/users'));
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    expect(res.headers.get('location')).toBeNull();
  });
});

describe('(d) the two profiles reads — order and conditionality (constraint 6)', () => {
  test('a live beta user on /dashboard performs exactly two reads, in order', async () => {
    process.env.IS_BETA_DEPLOY = 'true';
    mockProfile = { user_status: 'live', access_tier: 'beta' };
    await middleware(req('/dashboard'));
    expect(profileReads).toEqual(['profiles:is_suspended', 'profiles:user_status, access_tier']);
  });

  test('the SECOND read does not happen when the first redirects', async () => {
    // The invariant that makes "merge the two queries" a behaviour change
    // rather than an optimisation. A suspended user must cost one read, not two.
    process.env.IS_BETA_DEPLOY = 'true';
    mockSuspended = true;
    await middleware(req('/dashboard'));
    expect(profileReads).toEqual(['profiles:is_suspended']);
  });

  test('an anonymous request performs no reads at all', async () => {
    process.env.IS_BETA_DEPLOY = 'true';
    mockUser = null;
    await middleware(req('/'));
    expect(profileReads).toEqual([]);
  });

  test('each read selects only its own columns', async () => {
    // Pins the column lists so a future merge shows up as a gate selecting
    // columns it does not own, rather than as a silent single query.
    process.env.IS_BETA_DEPLOY = 'true';
    mockProfile = { user_status: 'live', access_tier: 'beta' };
    await middleware(req('/dashboard'));
    expect(profileReads[0]).toBe('profiles:is_suspended');
    expect(profileReads[1]).toBe('profiles:user_status, access_tier');
    expect(profileReads[0]).not.toContain('user_status');
    expect(profileReads[1]).not.toContain('is_suspended');
  });
});
