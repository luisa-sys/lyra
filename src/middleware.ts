import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { rateLimit, RATE_LIMITS } from '@/modules/guards/rate-limit';
import { withParentCookieDomain } from '@/modules/platform/cookie-domain';
import { cfAccessEnabled, verifyCfAccessToken } from '@/modules/guards/cf-access';
import { buildCspReportOnly } from '@/modules/guards/security-headers';
import { generateCspNonce, stampCspReportOnly } from '@/modules/access/csp';
import { buildDeployContext, type MiddlewareEnvRaw } from '@/modules/access/context';
import { clientIp } from '@/modules/guards/client-ip';

// SEC-120: the precedence rule lives in ONE place now — see
// src/modules/guards/client-ip.ts. It used to be duplicated here and in
// rate-limit-shared.ts, and the duplication was the recurrence mechanism.
function getClientIp(request: NextRequest): string {
  return clientIp(request.headers);
}

/**
 * Paths that make up the OAuth authorization server surface (SEC-36).
 *
 * Both the public `/.well-known/*` paths and the internal `/api/well-known/*`
 * they rewrite to are listed. Middleware sees the public path, but the rewrite
 * targets are directly addressable too, so gating only one half would leave a
 * back door.
 */
function isOauthServerPath(pathname: string): boolean {
  return (
    pathname.startsWith('/oauth/') ||
    pathname === '/.well-known/oauth-authorization-server' ||
    pathname === '/.well-known/jwks.json' ||
    pathname.startsWith('/api/well-known/')
  );
}

/**
 * The seven env reads, in one place, as data.
 *
 * They stay in THIS file deliberately. CTL-037's baseline
 * (env-access-baseline.json) records `src/middleware.ts` with exactly these
 * seven variables; relocating the reads would change that baseline without
 * changing anything about what is actually read. Handing the values on as a
 * plain object also makes every consumer testable without the ambient environment.
 */
function readMiddlewareEnv(): MiddlewareEnvRaw {
  return {
    IS_BETA_DEPLOY: process.env.IS_BETA_DEPLOY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    ADMIN_HOST: process.env.ADMIN_HOST,
    ADMIN_HOST_ENFORCED: process.env.ADMIN_HOST_ENFORCED,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const deploy = buildDeployContext(readMiddlewareEnv());

  // Lazy on purpose: the SEC-36 404 below returns before any document is
  // served and must not pay for a nonce it will never use. A getRandomValues
  // spy in middleware-response-contract.test.ts asserts exactly that.
  let cspCache: string | undefined;
  const csp = (): string => {
    if (cspCache === undefined) cspCache = buildCspReportOnly(generateCspNonce());
    return cspCache;
  };

  // ---------------------------------------------------------------------
  // SEC-36: beta has no OAuth authorization server. Turn it OFF, don't key it.
  //
  // Beta advertised ITSELF as the issuer and answered on /oauth/token,
  // /register and /revoke, while /.well-known/jwks.json returned 500 — it has
  // no RS256 keypair on the beta scope and never has. Verified 2026-08-09:
  // NOTHING points at it. Both resource servers derive the AS from
  // LYRA_SITE_URL — prod MCP leaves it unset (defaults to checklyra.com) and
  // dev MCP sets dev.checklyra.com. That is the "confirm unused" question
  // SEC-36 asked in June, answered with evidence.
  //
  // Giving beta a keypair would have been the WRONG fix. Beta runs on the
  // PRODUCTION Supabase project (gotcha #19), so a working beta AS would mint
  // tokens whose `sub` is a real production user and write jti rows into
  // production's oauth_access_tokens — a token factory for production
  // identities in the deliberately less-hardened environment, separated from
  // prod only by an `iss` string comparison in the verifier.
  //
  // 404, not 403: beta genuinely has no authorization server, and that is what
  // a client should discover. It also closes the unauthenticated DCR write
  // into production's oauth_clients via /oauth/register, which the beta gate
  // further down CANNOT reach because that one only runs for authenticated
  // requests.
  // ---------------------------------------------------------------------
  if (deploy.isBetaDeploy && isOauthServerPath(pathname)) {
    return new NextResponse(null, { status: 404 });
  }


  // KAN-309: admin.checklyra.com host routing. Enforced only when
  // ADMIN_HOST_ENFORCED=true (set on prod once the DNS + Cloudflare Access app
  // are live) — until then /admin keeps working on every host, so shipping this
  // code is non-breaking.
  const adminHost = deploy.adminHost;
  const adminHostEnforced = deploy.adminHostEnforced;
  const requestHost =
    request.headers.get('host') ?? request.headers.get('x-forwarded-host') ?? '';
  const isAdminHost = requestHost === adminHost;
  // SEC-34/SEC-37: app-layer Cloudflare Access verification is enforced once
  // CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD are set (inert before that).
  const cfEnabled = cfAccessEnabled();

  // Supabase PKCE: redirect code param to /auth/callback for session exchange
  const code = request.nextUrl.searchParams.get('code');
  if (code && pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/callback';
    return NextResponse.redirect(url);
  }

  // Rate limit auth endpoints (login, signup, auth callback)
  if (
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname.startsWith('/auth/')
  ) {
    // Only rate limit POST requests (form submissions)
    if (request.method === 'POST') {
      const ip = getClientIp(request);
      const { limited, retryAfter } = rateLimit(`auth:${ip}`, RATE_LIMITS.auth);
      if (limited) {
        return NextResponse.json(
          { error: 'Too many attempts. Please try again later.' },
          { status: 429, headers: { 'Retry-After': String(retryAfter) } }
        );
      }
    }
  }

  // Skip Supabase auth if env vars not configured
  const supabaseUrl = deploy.supabaseUrl;
  const supabaseAnonKey = deploy.supabaseAnonKey;

  if (!supabaseUrl || !supabaseAnonKey) {
    return stampCspReportOnly(NextResponse.next(), csp());
  }

  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, withParentCookieDomain(options))
        );
      },
    },
  });

  // Refresh the session — this is critical for server-side auth
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // KAN-309 / SEC-37: route the admin tools to the admin subdomain, and verify
  // Cloudflare Access on the admin host. Isolation applies when
  // ADMIN_HOST_ENFORCED=true OR CF Access is configured — so enabling CF Access
  // can never leave /admin reachable on a public host by forgetting a flag.
  if (adminHostEnforced || cfEnabled) {
    if (isAdminHost) {
      // SEC-34/SEC-37: every request reaching the admin host must carry a valid
      // Cloudflare Access JWT — this rejects anything that hit the origin
      // without transiting the CF edge (leaked preview URL, spoofed Host,
      // direct origin). Inert (allows all) until CF_ACCESS_* are configured.
      if (
        cfEnabled &&
        !(await verifyCfAccessToken(request.headers.get('cf-access-jwt-assertion')))
      ) {
        return new NextResponse('Forbidden: Cloudflare Access required.', {
          status: 403,
        });
      }
      // Let the auth/login flow, API routes and assets pass through unchanged.
      const passthrough =
        pathname === '/login' ||
        pathname.startsWith('/auth/') ||
        pathname.startsWith('/api/') ||
        pathname.startsWith('/_next/');
      if (!passthrough && !pathname.startsWith('/admin')) {
        // admin.checklyra.com/users → /admin/users, carrying refreshed cookies.
        const url = request.nextUrl.clone();
        url.pathname = '/admin' + (pathname === '/' ? '' : pathname);
        const rewrite = NextResponse.rewrite(url);
        supabaseResponse.cookies.getAll().forEach((c) => rewrite.cookies.set(c));
        return stampCspReportOnly(rewrite, csp());
      }
      // Already an /admin path (or passthrough) — serve it, and crucially skip
      // the beta gate below so an admin isn't bounced to /waitlist.
      return stampCspReportOnly(supabaseResponse, csp());
    }
    // Any non-admin host must never serve /admin — send it to the subdomain.
    if (pathname.startsWith('/admin')) {
      return NextResponse.redirect(
        new URL(`https://${adminHost}${pathname}${request.nextUrl.search}`),
      );
    }
  }

  // KAN-319: suspended-user gate (all deploys). A suspended user's public
  // profile is already hidden by RLS; this also blocks their own use of the app
  // and sends them to /suspended with an appeal route. Runs before the beta gate
  // so a suspended user lands on /suspended, not /waitlist. Exempts the
  // suspended page itself + the auth/logout flow + assets to avoid loops.
  const suspensionExempt =
    pathname === '/suspended' ||
    pathname === '/login' ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico';
  if (user && !suspensionExempt) {
    const { data: suspProfile, error: suspErr } = await supabase
      .from('profiles')
      .select('is_suspended')
      .eq('user_id', user.id)
      .maybeSingle();
    // Observability: never fail silently on a lookup error. We fail OPEN here
    // (let the request proceed) rather than closed, because a suspended user's
    // public exposure is already prevented at the data tier by RLS
    // (published-and-not-suspended), so this gate only governs their own
    // session — and failing closed on a transient profiles-read error would
    // wrongly lock out the whole authenticated userbase.
    if (suspErr) {
      console.error('[middleware] suspension lookup failed (failing open):', suspErr.message);
    }
    if (suspProfile?.is_suspended) {
      const url = request.nextUrl.clone();
      url.pathname = '/suspended';
      url.search = '';
      return NextResponse.redirect(url);
    }
  }

  // KAN-326: tier-aware access gate. Active on the "prod family" — the beta
  // deploy (IS_BETA_DEPLOY=true, tier 'beta') and the real production deploy
  // (checklyra.com, tier 'prod'). Dev/stage are single full envs (deployTier
  // null) and are not gated here. An authenticated user is:
  //   - not live          -> sent to /waitlist
  //   - live, wrong tier  -> sent to their tier's site (beta <-> prod), so a
  //                          promoted user always lands on the right site
  //                          (sessions carry via the shared .checklyra.com cookie).
  // The /waitlist page itself + auth pages are exempt to avoid redirect loops.
  const deployTier = deploy.deployTier;
  const exemptFromBetaGate =
    pathname === '/waitlist' ||
    pathname === '/suspended' || // KAN-319: suspended users land here, not /waitlist
    pathname === '/status' || // SEC-4: public status page is never beta-gated
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname === '/join' || // KAN-337: beta-invite deep-link sets a cookie + redirects to /signup
    pathname === '/confirm-age' || // 18+ declaration: ask before the waitlist bounce, not after
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico';

  if (deployTier && user && !exemptFromBetaGate) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('user_status, access_tier')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profile?.user_status !== 'live') {
      const url = request.nextUrl.clone();
      url.pathname = '/waitlist';
      url.search = '';
      return NextResponse.redirect(url);
    }
    if (profile.access_tier !== deployTier) {
      // Live user on the wrong site — move them to their tier's host, keeping path.
      const targetHost =
        profile.access_tier === 'prod'
          ? 'https://checklyra.com'
          : 'https://beta.checklyra.com';
      return NextResponse.redirect(
        new URL(`${targetHost}${pathname}${request.nextUrl.search}`),
      );
    }
  }

  // Redirect unauthenticated users away from protected routes
  if (!user && request.nextUrl.pathname.startsWith('/dashboard')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from auth pages
  if (
    user &&
    (request.nextUrl.pathname === '/login' ||
      request.nextUrl.pathname === '/signup')
  ) {
    const url = request.nextUrl.clone();
    // KAN-175: on beta, ineligible users belong at /waitlist, not /dashboard.
    // The dashboard redirect would just bounce them through the beta gate again.
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return stampCspReportOnly(supabaseResponse, csp());
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
