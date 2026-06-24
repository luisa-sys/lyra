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
  const isBetaDeploy = process.env.IS_BETA_DEPLOY === 'true';
  const isProdSite =
    process.env.NEXT_PUBLIC_SITE_URL === 'https://checklyra.com' &&
    process.env.VERCEL_ENV === 'production';
  const deployTier: 'beta' | 'prod' | null = isBetaDeploy
    ? 'beta'
    : isProdSite
      ? 'prod'
      : null;
  const exemptFromBetaGate =
    pathname === '/waitlist' ||
    pathname === '/suspended' || // KAN-319: suspended users land here, not /waitlist
    pathname === '/status' || // SEC-4: public status page is never beta-gated
    pathname === '/login' ||
    pathname === '/signup' ||
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

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
