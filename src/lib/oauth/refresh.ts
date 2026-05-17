/**
 * Refresh token repository — KAN-88 P4.
 *
 * Rotating refresh tokens. Each token has a family_id; on refresh we
 * mark the old token used and issue a new one in the same family. If
 * a used token is re-presented, treat the family as compromised and
 * revoke all tokens in the family (RFC 6749 §10.4 best-practice).
 *
 * Tokens are stored as sha256 hashes — the raw value lives only in
 * the JSON response to /oauth/token and the client's memory.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { randomBytes, createHash, randomUUID } from 'crypto';
import { oauthConfig } from './config';
import { issueAccessTokenJti } from './access-tokens';

function admin(): SupabaseClient {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false },
  });
}

export function generateRefreshToken(): string {
  return `lyra_refresh_${randomBytes(32).toString('base64url')}`;
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface IssueRefreshInput {
  clientId: string;
  userId: string;
  scope: string;
  /** If continuing an existing chain, pass the family_id; otherwise omit. */
  familyId?: string;
}

export async function issueRefreshToken(input: IssueRefreshInput): Promise<{ token: string; familyId: string }> {
  const sb = admin();
  const token = generateRefreshToken();
  const tokenHash = hashRefreshToken(token);
  const familyId = input.familyId ?? randomUUID();
  const expiresAt = new Date(Date.now() + oauthConfig.refreshTokenTtlSeconds * 1000);

  const { error } = await sb.from('oauth_refresh_tokens').insert({
    token_hash: tokenHash,
    client_id: input.clientId,
    user_id: input.userId,
    scope: input.scope,
    expires_at: expiresAt.toISOString(),
    family_id: familyId,
  });
  if (error) throw new Error(`refresh issue failed: ${error.message}`);
  return { token, familyId };
}

export interface RefreshTokenRecord {
  token_hash: string;
  client_id: string;
  user_id: string;
  scope: string;
  expires_at: string;
  used_at: string | null;
  family_id: string;
}

export async function getRefreshToken(rawToken: string): Promise<RefreshTokenRecord | null> {
  const sb = admin();
  const { data } = await sb
    .from('oauth_refresh_tokens')
    .select('*')
    .eq('token_hash', hashRefreshToken(rawToken))
    .maybeSingle();
  return (data as RefreshTokenRecord | null) ?? null;
}

/**
 * Try to mark a refresh token used. Returns the record if successful;
 * returns null if the token was already used (caller MUST treat as
 * a compromise and revoke the whole family — see revokeFamily).
 */
export async function tryMarkRefreshUsed(rawToken: string): Promise<RefreshTokenRecord | null> {
  const sb = admin();
  const tokenHash = hashRefreshToken(rawToken);
  const { data } = await sb
    .from('oauth_refresh_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('token_hash', tokenHash)
    .is('used_at', null)
    .select('*')
    .maybeSingle();
  return (data as RefreshTokenRecord | null) ?? null;
}

/**
 * Revoke every token in a family. Called when a used refresh token is
 * re-presented (compromise detected).
 */
export async function revokeFamily(familyId: string): Promise<void> {
  const sb = admin();
  // Mark all tokens in the family as used (and effectively dead).
  await sb
    .from('oauth_refresh_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('family_id', familyId)
    .is('used_at', null);

  // Best-effort: also revoke any access tokens still alive that were issued
  // from this family. Without a foreign-key tying access tokens to refresh
  // tokens, we can only revoke by (user_id, client_id) — that's a wider
  // sweep but acceptable for a compromise scenario.
  const { data: any_token } = await sb
    .from('oauth_refresh_tokens')
    .select('user_id, client_id')
    .eq('family_id', familyId)
    .limit(1)
    .maybeSingle();
  if (any_token) {
    const { user_id, client_id } = any_token as { user_id: string; client_id: string };
    await sb
      .from('oauth_access_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('user_id', user_id)
      .eq('client_id', client_id)
      .is('revoked_at', null);
  }
}

/**
 * Register a fresh access token's jti row (for revocation tracking).
 */
export { issueAccessTokenJti };
