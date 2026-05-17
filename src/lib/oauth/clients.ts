/**
 * OAuth client repository — KAN-88.
 *
 * CRUD operations on the `oauth_clients` table. Used by the registration
 * endpoint (P2) and by the authorize/token endpoints (P3/P4) to look up
 * the calling client.
 *
 * Service-role only — the lyra app holds SUPABASE_SERVICE_ROLE_KEY and is
 * the single writer/reader for this table.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { randomBytes, createHash } from 'crypto';

function admin(): SupabaseClient {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false },
  });
}

export interface RegisterClientInput {
  client_name: string;
  redirect_uris: string[];
  grant_types?: string[];
  response_types?: string[];
  application_type?: 'web' | 'native';
  token_endpoint_auth_method?: 'none' | 'client_secret_basic' | 'client_secret_post';
}

export interface RegisteredClient {
  client_id: string;
  client_secret?: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  application_type: string;
  token_endpoint_auth_method: string;
  scopes: string;
  client_id_issued_at: number;
}

export function generateClientId(): string {
  // ~22 chars, base64url, 128 bits of entropy. RFC 6749 doesn't constrain
  // the shape but we keep it human-copy-pasteable.
  return `lyra_oauth_${randomBytes(16).toString('base64url')}`;
}

export function generateClientSecret(): string {
  // 32 bytes = 43 base64url chars, 256 bits of entropy.
  return randomBytes(32).toString('base64url');
}

export function hashClientSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

const VALID_GRANT_TYPES = ['authorization_code', 'refresh_token'] as const;
const VALID_RESPONSE_TYPES = ['code'] as const;
const VALID_AUTH_METHODS = ['none', 'client_secret_basic', 'client_secret_post'] as const;

export type RegistrationError =
  | { code: 'invalid_redirect_uri'; description: string }
  | { code: 'invalid_client_metadata'; description: string };

export function validateRegisterInput(
  body: unknown
): { ok: true; input: RegisterClientInput } | { ok: false; error: RegistrationError } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: { code: 'invalid_client_metadata', description: 'body must be an object' } };
  }
  const b = body as Record<string, unknown>;

  const name = b.client_name;
  if (typeof name !== 'string' || name.length === 0 || name.length > 200) {
    return {
      ok: false,
      error: { code: 'invalid_client_metadata', description: 'client_name must be a non-empty string ≤200 chars' },
    };
  }

  const redirectUris = b.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0 || redirectUris.length > 10) {
    return {
      ok: false,
      error: { code: 'invalid_redirect_uri', description: 'redirect_uris must be a non-empty array (≤10)' },
    };
  }
  for (const uri of redirectUris) {
    if (typeof uri !== 'string') {
      return { ok: false, error: { code: 'invalid_redirect_uri', description: 'redirect_uris must be strings' } };
    }
    // Must be a valid absolute URL.
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      return { ok: false, error: { code: 'invalid_redirect_uri', description: `invalid URL: ${uri.slice(0, 80)}` } };
    }
    // Reject non-https except for localhost — RFC 8252 carve-out for native dev.
    const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !isLocalhost) {
      return {
        ok: false,
        error: {
          code: 'invalid_redirect_uri',
          description: `redirect_uri must use https (or http://localhost): ${uri.slice(0, 80)}`,
        },
      };
    }
    // Reject URLs with fragments (RFC 6749 §3.1.2).
    if (parsed.hash) {
      return {
        ok: false,
        error: { code: 'invalid_redirect_uri', description: `redirect_uri must not contain a fragment: ${uri.slice(0, 80)}` },
      };
    }
  }

  // Grant types (default to ['authorization_code']).
  let grantTypes = b.grant_types;
  if (grantTypes === undefined) {
    grantTypes = ['authorization_code'];
  }
  if (
    !Array.isArray(grantTypes) ||
    grantTypes.some(
      (g) => typeof g !== 'string' || !VALID_GRANT_TYPES.includes(g as (typeof VALID_GRANT_TYPES)[number])
    )
  ) {
    return {
      ok: false,
      error: {
        code: 'invalid_client_metadata',
        description: `grant_types must be a subset of [${VALID_GRANT_TYPES.join(', ')}]`,
      },
    };
  }

  // Response types — default ['code']. MVP only supports 'code'.
  let responseTypes = b.response_types;
  if (responseTypes === undefined) {
    responseTypes = ['code'];
  }
  if (
    !Array.isArray(responseTypes) ||
    responseTypes.some(
      (r) => typeof r !== 'string' || !VALID_RESPONSE_TYPES.includes(r as (typeof VALID_RESPONSE_TYPES)[number])
    )
  ) {
    return {
      ok: false,
      error: { code: 'invalid_client_metadata', description: 'response_types must be ["code"]' },
    };
  }

  // application_type — default 'web'.
  let appType = b.application_type;
  if (appType === undefined) appType = 'web';
  if (appType !== 'web' && appType !== 'native') {
    return {
      ok: false,
      error: { code: 'invalid_client_metadata', description: 'application_type must be "web" or "native"' },
    };
  }

  // token_endpoint_auth_method — default 'none' (public client).
  let authMethod = b.token_endpoint_auth_method;
  if (authMethod === undefined) authMethod = 'none';
  if (typeof authMethod !== 'string' || !VALID_AUTH_METHODS.includes(authMethod as (typeof VALID_AUTH_METHODS)[number])) {
    return {
      ok: false,
      error: {
        code: 'invalid_client_metadata',
        description: `token_endpoint_auth_method must be one of [${VALID_AUTH_METHODS.join(', ')}]`,
      },
    };
  }

  return {
    ok: true,
    input: {
      client_name: name,
      redirect_uris: redirectUris as string[],
      grant_types: grantTypes as string[],
      response_types: responseTypes as string[],
      application_type: appType as 'web' | 'native',
      token_endpoint_auth_method: authMethod as 'none' | 'client_secret_basic' | 'client_secret_post',
    },
  };
}

export async function createOauthClient(input: RegisterClientInput): Promise<RegisteredClient> {
  const sb = admin();
  const clientId = generateClientId();
  const isPublic = input.token_endpoint_auth_method === 'none';
  const secret = isPublic ? undefined : generateClientSecret();
  const secretHash = secret ? hashClientSecret(secret) : null;

  // ownership-ok: service-role insert (KAN-88).
  const { error } = await sb.from('oauth_clients').insert({
    client_id: clientId,
    client_secret_hash: secretHash,
    client_name: input.client_name,
    redirect_uris: input.redirect_uris,
    grant_types: input.grant_types,
    response_types: input.response_types,
    application_type: input.application_type,
    token_endpoint_auth_method: input.token_endpoint_auth_method,
    scopes: 'lyra:full',
  });

  if (error) throw new Error(`client registration failed: ${error.message}`);

  return {
    client_id: clientId,
    client_secret: secret,
    client_name: input.client_name,
    redirect_uris: input.redirect_uris,
    grant_types: input.grant_types ?? ['authorization_code'],
    response_types: input.response_types ?? ['code'],
    application_type: input.application_type ?? 'web',
    token_endpoint_auth_method: input.token_endpoint_auth_method ?? 'none',
    scopes: 'lyra:full',
    client_id_issued_at: Math.floor(Date.now() / 1000),
  };
}

export interface ClientRecord {
  client_id: string;
  client_secret_hash: string | null;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  application_type: string;
  token_endpoint_auth_method: string;
  scopes: string;
  revoked_at: string | null;
}

export async function getOauthClient(clientId: string): Promise<ClientRecord | null> {
  const sb = admin();
  const { data } = await sb
    .from('oauth_clients')
    .select(
      'client_id, client_secret_hash, client_name, redirect_uris, grant_types, response_types, application_type, token_endpoint_auth_method, scopes, revoked_at'
    )
    .eq('client_id', clientId)
    .maybeSingle();
  return (data as ClientRecord | null) ?? null;
}
