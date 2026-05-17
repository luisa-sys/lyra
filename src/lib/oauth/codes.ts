/**
 * OAuth authorization code repository — KAN-88 P3.
 *
 * Manages oauth_authorization_codes rows. Codes are:
 *   - 32 random bytes, base64url-encoded
 *   - bound to (client_id, user_id, redirect_uri, code_challenge)
 *   - one-time-use (used_at gates redemption)
 *   - short-lived (10min default per oauth config)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { randomBytes } from 'crypto';
import { oauthConfig } from './config';

function admin(): SupabaseClient {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false },
  });
}

export function generateAuthCode(): string {
  return randomBytes(32).toString('base64url');
}

export interface IssueCodeInput {
  clientId: string;
  userId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
}

export async function issueAuthCode(input: IssueCodeInput): Promise<{ code: string; expiresAt: Date }> {
  const sb = admin();
  const code = generateAuthCode();
  const expiresAt = new Date(Date.now() + oauthConfig.authorizationCodeTtlSeconds * 1000);

  // ownership-ok: service-role insert, scoped to the authenticated user (KAN-88).
  const { error } = await sb.from('oauth_authorization_codes').insert({
    code,
    client_id: input.clientId,
    user_id: input.userId,
    redirect_uri: input.redirectUri,
    scope: input.scope,
    code_challenge: input.codeChallenge,
    code_challenge_method: input.codeChallengeMethod,
    expires_at: expiresAt.toISOString(),
  });
  if (error) throw new Error(`code issue failed: ${error.message}`);
  return { code, expiresAt };
}

export interface CodeRecord {
  code: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  scope: string;
  code_challenge: string;
  code_challenge_method: string;
  expires_at: string;
  used_at: string | null;
}

export async function getAuthCode(code: string): Promise<CodeRecord | null> {
  const sb = admin();
  const { data } = await sb
    .from('oauth_authorization_codes')
    .select('*')
    .eq('code', code)
    .maybeSingle();
  return (data as CodeRecord | null) ?? null;
}

/**
 * Mark a code as used. Returns false if the code is already used —
 * the caller should treat this as code-reuse-attack and reject the
 * exchange. (P4 uses this in the token exchange path.)
 */
export async function markCodeUsed(code: string): Promise<boolean> {
  const sb = admin();
  const { data, error } = await sb
    .from('oauth_authorization_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('code', code)
    .is('used_at', null)
    .select('code')
    .maybeSingle();
  if (error) throw new Error(`code mark-used failed: ${error.message}`);
  return data !== null;
}
