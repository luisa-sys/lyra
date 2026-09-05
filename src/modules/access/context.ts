/**
 * The request context the access gates run against — KAN-415 D4.
 *
 * TWO CONTEXTS, AND THE SPLIT IS THE POINT
 * ----------------------------------------
 * `EdgeContext` has no `user` and no `supabase` client. Not because those are
 * inconvenient to thread, but because a gate that must run BEFORE authentication
 * should be unable to reach auth state at all.
 *
 * SEC-36's beta-OAuth 404 is the reason this matters. It exists to close an
 * unauthenticated DCR write into PRODUCTION's oauth_clients (beta runs on the
 * prod Supabase project, gotcha #19), so it must answer identically whether or
 * not anyone is signed in. Handing it a `user` field would make "check the user
 * first" a one-line edit that type-checks. Not handing it one makes that edit
 * impossible to write.
 *
 * `AuthedContext` extends it with the client, the user, and the live response
 * handle. Gates typed against it cannot be placed in the pre-auth pipeline —
 * see gate.ts for how the type system is made to enforce that rather than
 * merely document it.
 *
 * WHY `res` IS A HANDLE AND NOT A VALUE
 * ------------------------------------
 * `{ current: NextResponse }`, read at the moment of return, never captured
 * earlier. @supabase/ssr rotates the session DURING getUser and calls the
 * `setAll` cookie callback from inside it; that callback REBUILDS the response
 * object. Anything holding the earlier instance returns a response without the
 * refreshed cookie — every user logged out on token rotation, silently.
 *
 * That failure mode had no test at all until D4 C1; it now has one, and a
 * mutation capturing the response by value reddens exactly it.
 */
import type { NextRequest, NextResponse } from 'next/server';

/**
 * The raw env slice, read ONCE per request and passed as data.
 *
 * The seven direct env member expressions stay in src/middleware.ts, which
 * is what CTL-037's baseline records — it lists this file with exactly these
 * seven variables, and moving the reads would change that baseline without
 * changing what is read. Passing the values as data keeps the ratchet honest
 * and makes every consumer below testable without touching process.env.
 */
export interface MiddlewareEnvRaw {
  readonly IS_BETA_DEPLOY?: string;
  readonly NEXT_PUBLIC_SITE_URL?: string;
  readonly VERCEL_ENV?: string;
  readonly ADMIN_HOST?: string;
  readonly ADMIN_HOST_ENFORCED?: string;
  readonly NEXT_PUBLIC_SUPABASE_URL?: string;
  readonly NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
}

/** The derived deployment facts, computed once. */
export interface DeployContext {
  readonly isBetaDeploy: boolean;
  /**
   * KAN-326. The "prod family" only: the beta deploy and the real production
   * deploy. dev and staging are single full environments and are NOT tier-gated
   * — `null` is a meaningful third value, not a missing one.
   */
  readonly deployTier: 'beta' | 'prod' | null;
  readonly adminHost: string;
  readonly adminHostEnforced: boolean;
  readonly supabaseUrl?: string;
  readonly supabaseAnonKey?: string;
}

export const DEFAULT_ADMIN_HOST = 'admin.checklyra.com';

/**
 * Derived exactly as src/middleware.ts derived it inline. Transcribed, not
 * reinterpreted — a cross-product table test asserts old === new over every
 * combination of the three inputs that feed `deployTier`.
 */
export function buildDeployContext(env: MiddlewareEnvRaw): DeployContext {
  const isBetaDeploy = env.IS_BETA_DEPLOY === 'true';
  const isProdSite =
    env.NEXT_PUBLIC_SITE_URL === 'https://checklyra.com' && env.VERCEL_ENV === 'production';
  return {
    isBetaDeploy,
    deployTier: isBetaDeploy ? 'beta' : isProdSite ? 'prod' : null,
    adminHost: env.ADMIN_HOST ?? DEFAULT_ADMIN_HOST,
    adminHostEnforced: env.ADMIN_HOST_ENFORCED === 'true',
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

/** Everything available BEFORE authentication. Deliberately no user, no client. */
export interface EdgeContext {
  readonly request: NextRequest;
  readonly pathname: string;
  readonly env: DeployContext;
  /** Memoised. Not computed until a gate actually needs to stamp a document. */
  csp(): string;
}

/** Everything available AFTER the session boundary. */
export interface AuthedContext extends EdgeContext {
  readonly supabase: SupabaseLike;
  readonly user: { id: string } | null;
  /** Live handle — read `.current` at the point of return, never before. */
  readonly res: { current: NextResponse };
}

/**
 * The narrow slice of the Supabase client the gates actually use.
 *
 * Deliberately structural rather than importing SupabaseClient: the gates use
 * two methods, and a wide type here would let a future gate reach for anything
 * on the client without that showing up as a boundary change.
 */
export interface SupabaseLike {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        maybeSingle(): Promise<{
          data: Record<string, unknown> | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
}

/** Build the pre-auth context. `csp` is lazy so the SEC-36 404 pays nothing. */
export function createEdgeContext(
  request: NextRequest,
  env: DeployContext,
  buildCsp: () => string,
): EdgeContext {
  let cached: string | undefined;
  return {
    request,
    pathname: request.nextUrl.pathname,
    env,
    csp() {
      if (cached === undefined) cached = buildCsp();
      return cached;
    },
  };
}
