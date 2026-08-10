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
import { betaTier } from '@/modules/access/gates/beta-tier';
import { suspension } from '@/modules/access/gates/suspension';
import { establishSession } from '@/modules/access/session';
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

  // ── THE SESSION BOUNDARY ───────────────────────────────────────────────
  // Not a gate, deliberately: it is a precondition of the authed pipeline
  // existing at all, and modelling it as a gate would place it in an ordered
  // list where it could be moved. Everything above this line runs without
  // knowing who is asking; everything below may.
  const { supabase, user, res } = await establishSession(
    request,
    supabaseUrl,
    supabaseAnonKey,
  );
  // Read `res.current` at the point of RETURN, never captured here — the cookie
  // callback rebuilds it during getUser(). See session.ts.

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
        res.current.cookies.getAll().forEach((c) => rewrite.cookies.set(c));
        return stampCspReportOnly(rewrite, csp());
      }
      // Already an /admin path (or passthrough) — serve it, and crucially skip
      // the beta gate below so an admin isn't bounced to /waitlist.
      return stampCspReportOnly(res.current, csp());
    }
    // Any non-admin host must never serve /admin — send it to the subdomain.
    if (pathname.startsWith('/admin')) {
      return NextResponse.redirect(
        new URL(`https://${adminHost}${pathname}${request.nextUrl.search}`),
      );
    }
  }

  // ── AUTHED GATES (partial — the remaining three land in C7) ────────────
  // suspension BEFORE beta-tier, so a suspended user lands on /suspended
  // rather than /waitlist. Each gate carries its own reasoning; the ORDER is
  // asserted from the outside in middleware-gate-order.test.ts.
  const authed = { ...edge, supabase, user, res };
  const authedOutcome = await runGates([suspension, betaTier], authed);
  if (authedOutcome !== null) return authedOutcome;

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

  return stampCspReportOnly(res.current, csp());
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
