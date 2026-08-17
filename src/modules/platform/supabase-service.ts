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
import { env } from '@/modules/platform/env';
import type { Database } from '@/types/database';

/**
 * Returns a fresh service-role Supabase client with the hardened options above.
 * Callers must have already authorised the request — this client sees every row.
 *
 * SEC-132: the `<Database>` generic is load-bearing, not decoration.
 *
 * Until this was added the factory returned a BARE `SupabaseClient`, whose
 * `.from()` accepts any string and whose rows are `any`. So every service-role
 * read in the app — the ~40 modules that bypass RLS entirely — type-checked
 * against nothing. `.from('pubic_profiles')` would have compiled.
 *
 * That is what made the SEC-104 read path unchecked. The `public_profiles` view
 * is the mechanism that stops a suspended member reaching a public surface, and
 * a typo in its name would have failed at RUNTIME, on a public page, rather than
 * at build time. Worth stating plainly because the committed schema made it look
 * covered: `src/types/database/` is ~6,300 generated lines guarded by two
 * blocking controls (CTL-036, CTL-048), and before this commit **no application
 * code imported it at all**. It was generated, committed, drift-gated, and wired
 * to nothing.
 *
 * Note the generic is applied to `createClient` as well as the return type. The
 * return annotation alone would be a cast over an untyped value — it would
 * silence the compiler rather than inform it, which is the same failure in a new
 * costume.
 */
export function createServiceRoleClient(): SupabaseClient<Database> {
  return createClient<Database>(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
