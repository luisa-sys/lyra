/**
 * KAN-309 follow-on: the CURRENT user's own feature-entitlement read (web app).
 *
 * Cookie client (RLS owner-read) — least privilege. Used to gate the logged-in
 * user's OWN features (Convene pages/nav, uploads, discovery). For cross-user
 * checks (paid gift links on the recipient profile, admin tooling, MCP) use the
 * service-role reads in entitlements-service.ts instead.
 */
import { createClient as createCookieClient } from '@/lib/supabase-server';
import { resolveEntitlements, type FeatureKey } from './registry';

/** The current (cookie-authenticated) user's full entitlement map. */
export async function getMyFeatureEntitlements(): Promise<Record<FeatureKey, boolean>> {
  const supabase = await createCookieClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return resolveEntitlements([]);

  // Resolve the caller's profile id and filter explicitly — an admin's
  // RLS "read all" policy would otherwise return everyone's rows.
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile?.id) return resolveEntitlements([]);

  const { data } = await supabase
    .from('feature_entitlements')
    .select('feature_key, enabled')
    .eq('profile_id', profile.id);
  return resolveEntitlements(data ?? []);
}
