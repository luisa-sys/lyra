/**
 * Persist / read the 18+ self-declaration on a profile.
 *
 * `age_declared_18_at` is not in ALLOWED_PROFILE_FIELDS, so the user-facing
 * profile update action can't touch it. These helpers are its only writers.
 *
 * Read vs write asymmetry is deliberate. The READ takes the caller's own
 * request-scoped client — a user can always read their own profile under RLS,
 * so the read costs one indexed lookup and needs no service-role credentials on
 * the login path. Only the WRITE escalates to the service role.
 */
import { createServiceRoleClient } from '@/modules/platform/supabase-service';
import type { createClient as createServerClient } from '@/modules/platform/supabase-server';

type ServerClient = Awaited<ReturnType<typeof createServerClient>>;

/** Has this user already declared they're 18+? Read under the caller's own RLS. */
export async function hasDeclaredAge(
  supabase: ServerClient,
  userId: string,
): Promise<boolean> {
  if (!userId) return false;
  const { data } = await supabase
    .from('profiles')
    .select('age_declared_18_at')
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean((data as { age_declared_18_at?: string | null } | null)?.age_declared_18_at);
}

/**
 * Stamp the declaration. Idempotent: the `.is(null)` guard means re-running
 * never overwrites the ORIGINAL declaration timestamp with a later one — the
 * first affirmation is the one worth evidencing.
 */
export async function recordAgeDeclaration(userId: string): Promise<void> {
  if (!userId) return;
  const svc = createServiceRoleClient();
  await svc
    .from('profiles')
    .update({ age_declared_18_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('age_declared_18_at', null);
}
