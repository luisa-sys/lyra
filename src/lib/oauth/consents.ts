/**
 * OAuth consent repository — KAN-88 P3.
 *
 * Records each user-client consent grant. Used to skip the consent
 * screen for clients the user has previously authorised (re-auth flow
 * within a session goes straight through).
 *
 * Users can revoke consents from /dashboard/settings (P6 dashboard
 * surface). Revoking a consent does NOT invalidate already-issued
 * tokens — that's done separately via /oauth/revoke.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

function admin(): SupabaseClient {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false },
  });
}

export interface ConsentRecord {
  user_id: string;
  client_id: string;
  scopes: string;
  granted_at: string;
  revoked_at: string | null;
}

export async function getConsent(userId: string, clientId: string): Promise<ConsentRecord | null> {
  const sb = admin();
  const { data } = await sb
    .from('oauth_consents')
    .select('user_id, client_id, scopes, granted_at, revoked_at')
    .eq('user_id', userId)
    .eq('client_id', clientId)
    .maybeSingle();
  return (data as ConsentRecord | null) ?? null;
}

export async function recordConsent(userId: string, clientId: string, scopes: string): Promise<void> {
  const sb = admin();
  // Upsert — re-consenting replaces the previous grant timestamp and clears
  // any revoked_at.
  // ownership-ok: service-role write, the route already verified userId via
  // the Supabase session cookie (KAN-88).
  const { error } = await sb
    .from('oauth_consents')
    .upsert(
      {
        user_id: userId,
        client_id: clientId,
        scopes,
        granted_at: new Date().toISOString(),
        revoked_at: null,
      },
      { onConflict: 'user_id,client_id' }
    );
  if (error) throw new Error(`consent persist failed: ${error.message}`);
}
