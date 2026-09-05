import { createBrowserClient } from '@supabase/ssr';
import { env } from '@/modules/platform/env';

export function createClient() {
  return createBrowserClient(
    env.supabaseUrl(),
    env.supabaseAnonKey()
  );
}
