/**
 * KAN-352 (finding web-arch-4): the ONE hardened service-role Supabase client
 * factory.
 *
 * The service-role client bypasses ALL row-level security — it is the most
 * security-sensitive client in the app. Before this module it was hand-rolled
 * inline in ~30 app/lib files with drifting options, so any hardening change
 * had to be applied everywhere and was easy to miss. Route every service-role
 * construction through here instead.
 *
 * Hardened options baked in:
 *   - auth.persistSession: false      — never write a session to storage; this
 *                                        is a stateless server credential.
 *   - auth.autoRefreshToken: false    — the service-role key does not expire and
 *                                        must never spin a background refresh
 *                                        timer (which also leaks the process on
 *                                        serverless).
 *
 * CI guard: `scripts/check-service-role-client.sh` (wired into pr-checks.yml)
 * forbids any call to `env.supabaseServiceRoleKey()` outside this file, so new
 * inline service-role clients cannot be re-introduced.
 *
 * This is server-only code — importing it into a client component will fail at
 * build time because it reads a server-only secret.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

/**
 * Returns a fresh service-role Supabase client with the hardened options above.
 * Callers must have already authorised the request — this client sees every row.
 */
export function createServiceRoleClient(): SupabaseClient {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
