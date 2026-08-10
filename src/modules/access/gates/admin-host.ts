/**
 * KAN-309 / SEC-34 / SEC-37 — admin.checklyra.com host isolation.
 *
 * Lifted verbatim from src/middleware.ts. Three behaviours in one gate because
 * they are one decision — "is this request on the admin host, and is it
 * allowed":
 *
 *   1. On the admin host with CF Access configured, every request must carry a
 *      valid Cloudflare Access JWT. This rejects anything that hit the origin
 *      without transiting the CF edge — a leaked preview URL, a spoofed Host,
 *      a direct origin hit. Inert (allows all) until CF_ACCESS_* are set.
 *   2. On the admin host, non-passthrough non-/admin paths are REWRITTEN under
 *      /admin, carrying the refreshed cookies.
 *   3. On any other host, /admin is redirected to the admin subdomain.
 *
 * Isolation applies when ADMIN_HOST_ENFORCED=true OR CF Access is configured,
 * so enabling CF Access can never leave /admin reachable on a public host by
 * forgetting a flag.
 *
 * ⚠️ THE ADMIN PATH CHECK MUST STAY A LITERAL `.startsWith('/admin')`.
 * qa-sweep/inventory.py:342 derives the admin prefix list with the regex
 *     pathname\\.startsWith\\(\\s*'(/admin[^']*)'\\s*\\)
 * and an EMPTY derivation is fatal — inventory.py raises SystemExit2 because an
 * empty model "would flatter every coverage number downstream". The regex
 * matches inside `ctx.pathname.startsWith(...)`, so the form below is fine; a
 * refactor to a helper or a constant is not.
 */
import { NextResponse } from 'next/server';
import { cfAccessEnabled, verifyCfAccessToken } from '@/modules/guards/cf-access';
import type { AuthedContext } from '../context';
import { isExemptFrom } from '../exemptions';
import type { Gate } from '../gate';

export const adminHost: Gate<AuthedContext> = {
  id: 'admin-host',
  ticket: 'KAN-309',
  why: 'The admin console must exist only on its own host, behind Cloudflare Access.',
  run: async (ctx) => {
    const cfEnabled = cfAccessEnabled();
    if (!ctx.env.adminHostEnforced && !cfEnabled) return null;

    const requestHost =
      ctx.request.headers.get('host') ?? ctx.request.headers.get('x-forwarded-host') ?? '';
    const isAdminHost = requestHost === ctx.env.adminHost;

    if (isAdminHost) {
      if (
        cfEnabled &&
        !(await verifyCfAccessToken(ctx.request.headers.get('cf-access-jwt-assertion')))
      ) {
        return new NextResponse('Forbidden: Cloudflare Access required.', { status: 403 });
      }
      const passthrough = isExemptFrom('admin-passthrough', ctx.pathname);
      if (!passthrough && !ctx.pathname.startsWith('/admin')) {
        const url = ctx.request.nextUrl.clone();
        url.pathname = '/admin' + (ctx.pathname === '/' ? '' : ctx.pathname);
        const rewrite = NextResponse.rewrite(url);
        ctx.res.current.cookies.getAll().forEach((c) => rewrite.cookies.set(c));
        rewrite.headers.set('Content-Security-Policy-Report-Only', ctx.csp());
        return rewrite;
      }
      // Already an /admin path (or passthrough) — serve it, and crucially RETURN
      // so the beta gate below never runs. An admin whose own profile is not
      // `live` must still reach the console, or enabling the beta gate locks out
      // the operator. Pinned by middleware-gate-order.test.ts.
      ctx.res.current.headers.set('Content-Security-Policy-Report-Only', ctx.csp());
      return ctx.res.current;
    }

    // Any non-admin host must never serve /admin.
    if (ctx.pathname.startsWith('/admin')) {
      return NextResponse.redirect(
        new URL(`https://${ctx.env.adminHost}${ctx.pathname}${ctx.request.nextUrl.search}`),
      );
    }
    return null;
  },
};
