/**
 * Bearer-token API-key authentication for Convene admin endpoints.
 *
 * Mirrors the MCP server's authentication path: take an opaque
 * `lyra_<base64url>` API key from `Authorization: Bearer …`, sha256-hash
 * it, look up the row in api_keys, return the owning user_id.
 *
 * Used by /api/convene/admin/* routes that need server-to-server (no
 * cookie session) auth — currently just the queue-drain endpoint, but
 * we'll grow more admin tools later (resend-failed-invites, etc.).
 */
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { env } from '@/lib/env';

export interface BearerAuthResult {
  ok: true;
  userId: string;
  keyId: string;
}
export interface BearerAuthError {
  ok: false;
  status: 401;
  error: string;
}

function admin() {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false },
  });
}

export async function authenticateBearerApiKey(
  authHeader: string | null
): Promise<BearerAuthResult | BearerAuthError> {
  if (!authHeader) return { ok: false, status: 401, error: 'missing_bearer' };
  const m = authHeader.match(/^Bearer\s+(\S+)$/);
  if (!m) return { ok: false, status: 401, error: 'malformed_bearer' };
  const raw = m[1];
  if (!raw.startsWith('lyra_')) return { ok: false, status: 401, error: 'bad_prefix' };

  const keyHash = createHash('sha256').update(raw).digest('hex');
  const sb = admin();
  const { data, error } = await sb
    .from('api_keys')
    .select('id, user_id, revoked_at')
    .eq('key_hash', keyHash)
    .maybeSingle();
  if (error || !data) return { ok: false, status: 401, error: 'invalid_key' };
  const row = data as { id: string; user_id: string; revoked_at: string | null };
  if (row.revoked_at) return { ok: false, status: 401, error: 'revoked_key' };

  // touch last_used_at, best effort
  void sb.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', row.id);

  return { ok: true, userId: row.user_id, keyId: row.id };
}
