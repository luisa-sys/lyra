import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    env.supabaseUrl(),
    env.supabaseAnonKey(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            // KAN-274 — when COOKIE_DOMAIN is set (prod + beta only), scope
            // auth cookies to the parent domain so the session is shared
            // across checklyra.com ↔ beta.checklyra.com. Unset → leave
            // `options` untouched so the cookie stays host-scoped (dev/stage).
            // Secure + SameSite=Lax come from `options` and are preserved
            // because we spread it first.
            const domain = env.cookieDomain();
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(
                name,
                value,
                domain ? { ...options, domain } : options
              )
            );
          } catch {
            // Server Component — ignore
          }
        },
      },
    }
  );
}
