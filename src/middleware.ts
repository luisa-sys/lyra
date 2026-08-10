import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { rateLimit, RATE_LIMITS } from '@/modules/guards/rate-limit';
import { withParentCookieDomain } from '@/modules/platform/cookie-domain';
import { cfAccessEnabled, verifyCfAccessToken } from '@/modules/guards/cf-access';
import { buildCspReportOnly } from '@/modules/guards/security-headers';
import { generateCspNonce, stampCspReportOnly } from '@/modules/access/csp';
import {
  buildDeployContext,
  createEdgeContext,
  type MiddlewareEnvRaw,
} from '@/modules/access/context';
import { isExemptFrom } from '@/modules/access/exemptions';
import { isOauthServerPath } from '@/modules/access/oauth-server-paths';
import { runGates } from '@/modules/access/gate';
import { PRE_AUTH_PIPELINE } from '@/modules/access/pipeline';
import { clientIp } from '@/modules/guards/client-ip';

// SEC-120: the precedence rule lives in ONE place now — see
// src/modules/guards/client-ip.ts. It used to be duplicated here and in
// rate-limit-shared.ts, and the duplication was the recurrence mechanism.
function getClientIp(request: NextRequest): string {
  return clientIp(request.headers);
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

  // ── PRE-AUTHENTICATION GATES ───────────────────────────────────────────
  // Three gates, in an order that is behaviour rather than style: the SEC-36
  // beta-OAuth 404 must not be reachable by staying under a rate limit and must
  // not depend on auth state; the PKCE redirect must precede anything that
  // could bounce a user mid-exchange. Each carries its own reasoning in
  // src/modules/access/gates/, and the order is asserted from the outside in
  // tests/unit/middleware-gate-order.test.ts.
  //
  // They run against an EdgeContext, which has no `user` and no Supabase
  // client — so "check the user first" is not an edit that can be written here.
  // KAN-309 / SEC-34 / SEC-37 admin-host facts. Derived here rather than in a
  // gate because three later blocks read them; they move with the admin gate in
  // C7. `cfEnabled` is inert until CF_ACCESS_* are configured.
  const adminHost = deploy.adminHost;
  const adminHostEnforced = deploy.adminHostEnforced;
  const requestHost =
    request.headers.get('host') ?? request.headers.get('x-forwarded-host') ?? '';
  const isAdminHost = requestHost === adminHost;
  const cfEnabled = cfAccessEnabled();

  const edge = createEdgeContext(request, deploy, csp);
  const preAuth = await runGates(PRE_AUTH_PIPELINE, edge);
  if (preAuth !== null) return preAuth;

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
      const passthrough = isExemptFrom('admin-passthrough', pathname);
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
  const suspensionExempt = isExemptFrom('suspension', pathname);
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
  const exemptFromBetaGate = isExemptFrom('beta-tier', pathname);

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
