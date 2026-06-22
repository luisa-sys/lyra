import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { withParentCookieDomain } from '@/lib/cookie-domain';

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

  // KAN-309: admin.checklyra.com host routing. Enforced only when
  // ADMIN_HOST_ENFORCED=true (set on prod once the DNS + Cloudflare Access app
  // are live) — until then /admin keeps working on every host, so shipping this
  // code is non-breaking.
  const adminHost = process.env.ADMIN_HOST ?? 'admin.checklyra.com';
  const adminHostEnforced = process.env.ADMIN_HOST_ENFORCED === 'true';
  const requestHost =
    request.headers.get('host') ?? request.headers.get('x-forwarded-host') ?? '';
  const isAdminHost = requestHost === adminHost;

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

  // KAN-309: route the admin tools to the admin subdomain (once enforced).
  if (adminHostEnforced) {
    if (isAdminHost) {
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
        return rewrite;
      }
      // Already an /admin path (or passthrough) — serve it, and crucially skip
      // the beta gate below so an admin isn't bounced to /waitlist.
      return supabaseResponse;
    }
    // Any non-admin host must never serve /admin — send it to the subdomain.
    if (pathname.startsWith('/admin')) {
      return NextResponse.redirect(
        new URL(`https://${adminHost}${pathname}${request.nextUrl.search}`),
      );
    }
  }

  // KAN-175: Beta gate. Only active on the beta deploy (IS_BETA_DEPLOY=true).
  // Authenticated users without is_beta_eligible=true get redirected to
  // /waitlist. The /waitlist page itself is exempt so the redirect doesn't
  // loop. Auth pages and the auth callback are also exempt so users can
  // complete sign-in before the gate evaluates them.
  const isBetaDeploy = process.env.IS_BETA_DEPLOY === 'true';
  const exemptFromBetaGate =
    pathname === '/waitlist' ||
    pathname === '/status' || // SEC-4: public status page is never beta-gated
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
