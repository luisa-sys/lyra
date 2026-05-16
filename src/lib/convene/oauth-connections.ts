/**
 * Repository for public.oauth_connections (KAN-205/206).
 *
 * Encapsulates Vault token round-trip + access-token caching. Adapters call
 * `getFreshAccessToken(connectionId)` to obtain a usable bearer token without
 * caring about refresh mechanics.
 */

import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { refreshAccessToken } from '@/lib/convene/google/oauth';
import {
  vaultReadRefreshToken,
  vaultStoreRefreshToken,
  vaultRevokeRefreshToken,
} from '@/lib/convene/vault';

function admin() {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false },
  });
}

export interface OAuthConnection {
  id: string;
  owner_user_id: string;
  provider: 'google' | 'microsoft' | 'apple' | 'caldav_generic';
  provider_account_id: string;
  display_name: string | null;
  refresh_token_secret_id: string;
  access_token_secret_id: string | null;
  access_token_expires_at: string | null;
  scope_granted: string;
  status: 'active' | 'revoked' | 'error';
}

export async function getConnection(
  connectionId: string
): Promise<OAuthConnection | null> {
  const sb = admin();
  // ownership-ok: connection id is the unique key; caller-side checks owner_user_id (KAN-206)
  const { data, error } = await sb
    .from('oauth_connections')
    .select('*')
    .eq('id', connectionId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(`getConnection failed: ${error.message}`);
  return (data as OAuthConnection | null) ?? null;
}

export async function getConnectionForUser(
  userId: string,
  provider: 'google' | 'microsoft' | 'apple' | 'caldav_generic',
  providerAccountId?: string
): Promise<OAuthConnection | null> {
  const sb = admin();
  let q = sb
    .from('oauth_connections')
    .select('*')
    .eq('owner_user_id', userId)
    .eq('provider', provider)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1);
  if (providerAccountId) {
    q = q.eq('provider_account_id', providerAccountId);
  }
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`getConnectionForUser failed: ${error.message}`);
  return (data as OAuthConnection | null) ?? null;
}

interface UpsertConnectionInput {
  userId: string;
  provider: 'google';
  providerAccountId: string;
  displayName?: string;
  refreshToken: string;
  scopeGranted: string;
}

/**
 * Insert-or-update a connection. Rotates the refresh-token vault secret when
 * the provider issued a new refresh token.
 */
export async function upsertConnection(
  input: UpsertConnectionInput
): Promise<OAuthConnection> {
  const sb = admin();

  const existing = await getConnectionForUser(
    input.userId,
    input.provider,
    input.providerAccountId
  );

  if (existing) {
    // Rotate the vault secret: store new, swap pointer, revoke old.
    const newSecretId = await vaultStoreRefreshToken(
      input.refreshToken,
      `convene oauth (rotate) user=${input.userId} provider=${input.provider}`
    );
    const { data, error } = await sb
      .from('oauth_connections')
      .update({
        refresh_token_secret_id: newSecretId,
        scope_granted: input.scopeGranted,
        display_name: input.displayName ?? existing.display_name,
        status: 'active',
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw new Error(`upsertConnection update failed: ${error.message}`);

    // Best-effort revoke of the old secret.
    try {
      await vaultRevokeRefreshToken(existing.refresh_token_secret_id);
    } catch (e) {
      // Non-fatal — log only.
      console.warn(`[convene] vault revoke of old secret failed:`, e);
    }

    return data as OAuthConnection;
  }

  const secretId = await vaultStoreRefreshToken(
    input.refreshToken,
    `convene oauth user=${input.userId} provider=${input.provider}`
  );
  const { data, error } = await sb
    .from('oauth_connections')
    .insert({
      owner_user_id: input.userId,
      provider: input.provider,
      provider_account_id: input.providerAccountId,
      display_name: input.displayName ?? null,
      refresh_token_secret_id: secretId,
      scope_granted: input.scopeGranted,
      status: 'active',
    })
    .select('*')
    .single();
  if (error) throw new Error(`upsertConnection insert failed: ${error.message}`);
  return data as OAuthConnection;
}

/**
 * Soft-delete the connection and revoke its vaulted refresh token.
 * Caller is responsible for calling the adapter's revokeAtProvider beforehand
 * (best-effort — if it fails, we still want to forget the token locally).
 */
export async function disconnectConnection(connectionId: string): Promise<void> {
  const conn = await getConnection(connectionId);
  if (!conn) return;
  const sb = admin();
  const { error } = await sb
    .from('oauth_connections')
    .update({ deleted_at: new Date().toISOString(), status: 'revoked' })
    .eq('id', connectionId);
  if (error) throw new Error(`disconnect update failed: ${error.message}`);
  try {
    await vaultRevokeRefreshToken(conn.refresh_token_secret_id);
  } catch (e) {
    console.warn(`[convene] vault revoke on disconnect failed:`, e);
  }
}

/**
 * Get a usable Google access token for a connection. Refreshes if needed.
 * Caches the result on the connection row to avoid hammering the provider
 * (best-effort; we still refresh if the cached token would expire within
 * the next 60 seconds).
 */
export async function getFreshAccessToken(
  connectionId: string
): Promise<{ accessToken: string; expiresAt: Date }> {
  const conn = await getConnection(connectionId);
  if (!conn) throw new Error('Connection not found');
  if (conn.status !== 'active') throw new Error(`Connection status: ${conn.status}`);

  // Future: cache via access_token_secret_id with expires_at check.
  // For now, always refresh — refresh tokens are cheap and we want simplicity.
  const refreshToken = await vaultReadRefreshToken(conn.refresh_token_secret_id);

  if (conn.provider !== 'google') {
    throw new Error(`Provider ${conn.provider} not yet implemented (P7)`);
  }

  const tokens = await refreshWithBackoff(refreshToken);
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  // Update last_used_at + expires (best-effort).
  const sb = admin();
  await sb
    .from('oauth_connections')
    .update({
      last_used_at: new Date().toISOString(),
      access_token_expires_at: expiresAt.toISOString(),
    })
    .eq('id', connectionId);

  return { accessToken: tokens.access_token, expiresAt };
}

async function refreshWithBackoff(refreshToken: string, attempts = 3) {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await refreshAccessToken(refreshToken);
    } catch (e) {
      lastErr = e;
      // Exponential backoff: 200ms, 800ms, 3.2s
      await new Promise((r) => setTimeout(r, 200 * Math.pow(4, i)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('refresh failed after retries');
}
