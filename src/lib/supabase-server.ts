import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';
import { withParentCookieDomain } from '@/lib/cookie-domain';

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
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, withParentCookieDomain(options))
            );
          } catch {
            // Server Component — ignore
          }
        },
      },
    }
  );
}
