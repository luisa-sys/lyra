/**
 * Access-token registry — KAN-88 P4.
 *
 * Records jti + metadata for every issued JWT so the AS can revoke
 * specific tokens before they expire. The JWT itself is self-validating
 * (HS256 signature + exp claim); this registry only matters when
 * revocation needs to bite mid-lifetime.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

function admin(): SupabaseClient {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false },
  });
}

export interface IssueAccessJtiInput {
  jti: string;
  clientId: string;
  userId: string;
  scope: string;
  expiresAt: Date;
}

export async function issueAccessTokenJti(input: IssueAccessJtiInput): Promise<void> {
  const sb = admin();
  const { error } = await sb.from('oauth_access_tokens').insert({
    jti: input.jti,
    client_id: input.clientId,
    user_id: input.userId,
    scope: input.scope,
    expires_at: input.expiresAt.toISOString(),
  });
  if (error) throw new Error(`access-token registry write failed: ${error.message}`);
}

export interface AccessTokenRecord {
  jti: string;
  client_id: string;
  user_id: string;
  scope: string;
  expires_at: string;
  revoked_at: string | null;
}

export async function getAccessTokenJti(jti: string): Promise<AccessTokenRecord | null> {
  const sb = admin();
  const { data } = await sb
    .from('oauth_access_tokens')
    .select('jti, client_id, user_id, scope, expires_at, revoked_at')
    .eq('jti', jti)
    .maybeSingle();
  return (data as AccessTokenRecord | null) ?? null;
}

export async function revokeAccessTokenJti(jti: string): Promise<void> {
  const sb = admin();
  await sb
    .from('oauth_access_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('jti', jti);
}
