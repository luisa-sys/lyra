import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { env } from '@/lib/env';

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  );
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

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
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.next();
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
        // KAN-274 — see src/lib/supabase-server.ts. When COOKIE_DOMAIN is set
        // (prod + beta only) we scope the cookie to the parent domain for
        // cross-subdomain SSO; spreading `options` first keeps Secure +
        // SameSite=Lax intact. Unset → host-scoped (dev/stage unchanged).
        const cookieDomain = env.cookieDomain();
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(
            name,
            value,
            cookieDomain ? { ...options, domain: cookieDomain } : options
          )
        );
      },
    },
  });

  // Refresh the session — this is critical for server-side auth
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // KAN-175: Beta gate. Only active on the beta deploy (IS_BETA_DEPLOY=true).
  // Authenticated users without is_beta_eligible=true get redirected to
  // /waitlist. The /waitlist page itself is exempt so the redirect doesn't
  // loop. Auth pages and the auth callback are also exempt so users can
  // complete sign-in before the gate evaluates them.
  const isBetaDeploy = process.env.IS_BETA_DEPLOY === 'true';
  const exemptFromBetaGate =
    pathname === '/waitlist' ||
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico';

  if (isBetaDeploy && user && !exemptFromBetaGate) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_beta_eligible')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!profile?.is_beta_eligible) {
      const url = request.nextUrl.clone();
      url.pathname = '/waitlist';
      url.search = '';
      return NextResponse.redirect(url);
    }
  }

  // KAN-278: approved-user routing. On PROD (NOT the beta deploy) and only
  // when BETA_ROUTING_ENABLED is flipped on, an authenticated user who has
  // been approved for the beta (beta_access_status='approved', or the legacy
  // is_beta_eligible flag) is sent over to the beta deploy, path preserved.
  // INERT by default: with BETA_ROUTING_ENABLED unset this whole block is a
  // no-op, so dev/stage and pre-cutover prod are unchanged. Auth/api/static/
  // callback paths are exempt to avoid bouncing sign-in mid-flight and to
  // avoid redirect loops.
  const exemptFromBetaRouting =
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico';

  if (
    !isBetaDeploy &&
    env.betaRoutingEnabled() &&
    user &&
    !exemptFromBetaRouting
  ) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('beta_access_status, is_beta_eligible')
      .eq('user_id', user.id)
      .maybeSingle();

    if (
      profile?.beta_access_status === 'approved' ||
      profile?.is_beta_eligible
    ) {
      const target = new URL(env.betaAppUrl());
      target.pathname = pathname;
      target.search = request.nextUrl.search;
      return NextResponse.redirect(target);
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

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
