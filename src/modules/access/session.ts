/**
 * The session boundary — KAN-415 D4 C5.
 *
 * Everything the middleware needs in order to know WHO is asking: the Supabase
 * client, its cookie plumbing, and the `getUser()` call that refreshes the
 * session. Lifted from src/middleware.ts unchanged.
 *
 * ⚠️ THE RESPONSE IS A LIVE HANDLE, NOT A VALUE, AND THAT IS THE WHOLE POINT.
 *
 * @supabase/ssr rotates the session DURING `getUser()` and calls the `setAll`
 * cookie callback from inside it. That callback REBUILDS the response object —
 * `NextResponse.next({ request })` with the refreshed cookies applied. So the
 * response that must eventually be returned to the browser does not exist yet
 * when this function starts, and anything holding the earlier instance returns
 * a response WITHOUT the refreshed cookie.
 *
 * The visible symptom is every user being logged out on token rotation. The
 * invisible part is that until D4 C1 there was no test that could see it:
 * `options.cookies.setAll` was invoked by ZERO of the 33 middleware tests,
 * because both mocks constructed `createServerClient` as a zero-argument
 * factory and discarded the options object. There is now a test that refreshes
 * during `getUser` and asserts the cookie lands, on both document-serving
 * exits, and a mutation capturing the response by value reddens exactly it.
 *
 * Hence `{ current }`: callers read `.current` at the moment they return, never
 * before.
 */
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { withParentCookieDomain } from '@/modules/platform/cookie-domain';
import type { SupabaseLike } from './context';

export interface Session {
  readonly supabase: SupabaseLike;
  readonly user: { id: string } | null;
  /** Live handle. Read `.current` at the point of return. */
  readonly res: { current: NextResponse };
}

/**
 * Build the client, refresh the session, and hand back both the user and the
 * response handle.
 *
 * The caller decides what to do when Supabase is not configured — see the
 * named fail-open boundary in src/middleware.ts. Deliberately NOT a gate: it is
 * a precondition of the authed pipeline existing at all, and modelling it as a
 * gate would put it in an ordered list where it could be moved.
 */
export async function establishSession(
  request: NextRequest,
  supabaseUrl: string,
  supabaseAnonKey: string,
): Promise<Session> {
  const res: { current: NextResponse } = { current: NextResponse.next({ request }) };

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        // Rebuild from the mutated request, then re-apply with the parent
        // cookie domain so the session is shared across *.checklyra.com
        // (SEC-40). Both halves are load-bearing and were lifted together.
        res.current = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          res.current.cookies.set(name, value, withParentCookieDomain(options)),
        );
      },
    },
  });

  // Refreshing the session is the reason this middleware runs on every request.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabase: supabase as unknown as SupabaseLike, user, res };
}
