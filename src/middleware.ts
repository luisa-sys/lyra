import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { rateLimit, RATE_LIMITS } from '@/modules/guards/rate-limit';
import { withParentCookieDomain } from '@/modules/platform/cookie-domain';
import { buildCspReportOnly } from '@/modules/guards/security-headers';
import { generateCspNonce, stampCspReportOnly } from '@/modules/access/csp';
import {
  buildDeployContext,
  createEdgeContext,
  type AuthedContext,
  type MiddlewareEnvRaw,
} from '@/modules/access/context';
import { isExemptFrom } from '@/modules/access/exemptions';
import { isOauthServerPath } from '@/modules/access/oauth-server-paths';
import { runGates } from '@/modules/access/gate';
import { betaTier } from '@/modules/access/gates/beta-tier';
import { suspension } from '@/modules/access/gates/suspension';
import { establishSession } from '@/modules/access/session';
import { AUTHED_PIPELINE, PRE_AUTH_PIPELINE } from '@/modules/access/pipeline';
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

  // ── AUTHED GATES ───────────────────────────────────────────────────────
  // Five gates, in an order that is behaviour rather than style: admin-host
  // returns early so an operator whose own profile is not `live` still reaches
  // the console; suspension precedes beta-tier so a suspended user lands on
  // /suspended rather than /waitlist. Each gate carries its own reasoning in
  // src/modules/access/gates/, and every ordering is asserted from the outside
  // in tests/unit/middleware-gate-order.test.ts.
  const authed: AuthedContext = { ...edge, supabase, user, res };
  const authedOutcome = await runGates(AUTHED_PIPELINE, authed);
  if (authedOutcome !== null) return authedOutcome;


  return stampCspReportOnly(res.current, csp());
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
