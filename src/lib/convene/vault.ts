/**
 * Thin Supabase Vault wrapper.
 *
 * Refresh tokens are stored encrypted using Supabase Vault (libsodium under the
 * hood). The plaintext token is never persisted in `oauth_connections` — only
 * the Vault secret ID. Decryption happens server-side only, via the service
 * role, when we need to refresh an access token.
 *
 * SPIKE quality (KAN-204). Hardened in P1 (KAN-205).
 */

import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

function adminClient() {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false },
  });
}

/**
 * Stores a refresh token in Supabase Vault and returns the secret ID.
 * Caller persists the secret ID in `oauth_connections.refresh_token_secret_id`.
 */
export async function vaultStoreRefreshToken(
  refreshToken: string,
  description: string
): Promise<string> {
  const sb = adminClient();
  const { data, error } = await sb.rpc('convene_vault_store_secret', {
    p_secret: refreshToken,
    p_description: description,
  });
  if (error) {
    throw new Error(`Vault store failed: ${error.message}`);
  }
  return data as string;
}

/**
 * Retrieves a refresh token from Vault by secret ID. Service-role only.
 */
export async function vaultReadRefreshToken(
  secretId: string
): Promise<string> {
  const sb = adminClient();
  const { data, error } = await sb.rpc('convene_vault_read_secret', {
    p_secret_id: secretId,
  });
  if (error) {
    throw new Error(`Vault read failed: ${error.message}`);
  }
  return data as string;
}

/**
 * Permanently revokes a secret. Used on disconnect.
 */
export async function vaultRevokeRefreshToken(
  secretId: string
): Promise<void> {
  const sb = adminClient();
  const { error } = await sb.rpc('convene_vault_revoke_secret', {
    p_secret_id: secretId,
  });
  if (error) {
    throw new Error(`Vault revoke failed: ${error.message}`);
  }
}
