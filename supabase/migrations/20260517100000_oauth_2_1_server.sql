-- KAN-88 — OAuth 2.1 authorization server schema.
--
-- Lyra acts as an OAuth 2.1 Authorization Server, issuing access + refresh
-- tokens to MCP clients (claude.ai, Claude Desktop, etc). Clients register
-- via Dynamic Client Registration (RFC 7591) and use Authorization Code +
-- PKCE (S256) to obtain access tokens.
--
-- Tables:
--   oauth_clients              — registered OAuth clients (one row per
--                                claude.ai install + any other clients).
--                                Dynamically registered via /oauth/register.
--   oauth_authorization_codes  — short-lived (≤10 min), one-time codes
--                                exchanged for tokens at /oauth/token.
--   oauth_access_tokens        — issued JWTs, recorded by `jti` for
--                                revocation tracking. JWT validation does
--                                not strictly require this table (HS256
--                                self-validating) but revocation does.
--   oauth_refresh_tokens       — opaque refresh tokens (30-day TTL),
--                                rotated on every use.
--   oauth_consents             — record of each user-client consent grant,
--                                so we can show "you previously authorised
--                                X — confirm?" rather than always re-asking.
--
-- All tables are write-only by the service role; users never directly read
-- or write them. RLS is enabled and denies all by default; the lyra app
-- uses SUPABASE_SERVICE_ROLE_KEY to bypass.

-- ─── oauth_clients ────────────────────────────────────────────────────────

create table public.oauth_clients (
  id uuid primary key default gen_random_uuid(),
  -- The public-facing client_id we hand out. Random base64url, ~22 chars.
  client_id text unique not null,
  -- For confidential clients only. Public clients (PKCE-only) have NULL.
  client_secret_hash text,
  -- Registration metadata (RFC 7591). Free-form within the schema.
  client_name text not null,
  redirect_uris text[] not null,
  -- Comma-separated grant types. For us: 'authorization_code', 'refresh_token'.
  grant_types text[] not null default array['authorization_code', 'refresh_token'],
  response_types text[] not null default array['code'],
  -- Application type per RFC 7591. Most MCP clients are 'web'.
  application_type text not null default 'web' check (application_type in ('web', 'native')),
  -- Token endpoint auth method. Public clients use 'none' (PKCE only).
  token_endpoint_auth_method text not null default 'none' check (
    token_endpoint_auth_method in ('none', 'client_secret_basic', 'client_secret_post')
  ),
  -- Scope this client is allowed to request. For MVP all clients get 'lyra:full'.
  scopes text not null default 'lyra:full',
  -- Soft-state — admin can revoke a misbehaving client without dropping rows.
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index oauth_clients_client_id_idx on public.oauth_clients (client_id);
alter table public.oauth_clients enable row level security;
-- Service-role only. No user policy.

comment on table public.oauth_clients is 'KAN-88 — OAuth 2.1 registered clients. Service-role writes only.';

-- ─── oauth_authorization_codes ────────────────────────────────────────────

create table public.oauth_authorization_codes (
  code text primary key,                                -- random 32-byte token, base64url
  client_id text not null references public.oauth_clients(client_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  redirect_uri text not null,
  scope text not null,
  -- PKCE — S256 only per OAuth 2.1.
  code_challenge text not null,
  code_challenge_method text not null check (code_challenge_method = 'S256'),
  expires_at timestamptz not null,
  -- Set when redeemed to enforce one-time use.
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index oauth_authz_codes_client_idx on public.oauth_authorization_codes (client_id);
create index oauth_authz_codes_expires_idx on public.oauth_authorization_codes (expires_at);
alter table public.oauth_authorization_codes enable row level security;

comment on table public.oauth_authorization_codes is 'KAN-88 — One-time, short-lived (≤10 min) authorization codes exchanged at /oauth/token.';

-- ─── oauth_access_tokens ──────────────────────────────────────────────────
-- We only record the JWT's `jti` claim + metadata. The token itself is the
-- signed JWT (HS256 with OAUTH_JWT_SIGNING_SECRET) and is self-validating.
-- This table exists so we can revoke specific tokens before they expire.

create table public.oauth_access_tokens (
  jti uuid primary key default gen_random_uuid(),
  client_id text not null references public.oauth_clients(client_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  issued_at timestamptz not null default now()
);

create index oauth_access_tokens_user_idx on public.oauth_access_tokens (user_id);
create index oauth_access_tokens_expires_idx on public.oauth_access_tokens (expires_at);
alter table public.oauth_access_tokens enable row level security;

comment on table public.oauth_access_tokens is 'KAN-88 — Issued JWT registry (jti only — not the signed token). Used for revocation lookups.';

-- ─── oauth_refresh_tokens ─────────────────────────────────────────────────

create table public.oauth_refresh_tokens (
  -- Random opaque token; we store the sha256 hash, never the raw value.
  token_hash text primary key,
  client_id text not null references public.oauth_clients(client_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null,
  expires_at timestamptz not null,
  -- Refresh-token rotation: when the holder exchanges this token for a new
  -- access token + new refresh token, we mark the old one used. Subsequent
  -- presentation of the same token => treat as compromised, revoke the chain.
  used_at timestamptz,
  -- Allows revoking the whole chain when a leak is detected.
  family_id uuid not null,
  issued_at timestamptz not null default now()
);

create index oauth_refresh_tokens_user_idx on public.oauth_refresh_tokens (user_id);
create index oauth_refresh_tokens_family_idx on public.oauth_refresh_tokens (family_id);
create index oauth_refresh_tokens_expires_idx on public.oauth_refresh_tokens (expires_at);
alter table public.oauth_refresh_tokens enable row level security;

comment on table public.oauth_refresh_tokens is 'KAN-88 — Rotating refresh tokens with family chain for compromise detection.';

-- ─── oauth_consents ───────────────────────────────────────────────────────

create table public.oauth_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null references public.oauth_clients(client_id) on delete cascade,
  scopes text not null,                                 -- space-separated, e.g. 'lyra:full'
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, client_id)
);

create index oauth_consents_user_idx on public.oauth_consents (user_id);
alter table public.oauth_consents enable row level security;
-- Users CAN read + revoke their own consents from a future dashboard page.
create policy oauth_consents_own_select on public.oauth_consents
  for select using (auth.uid() = user_id);
create policy oauth_consents_own_update on public.oauth_consents
  for update using (auth.uid() = user_id);

comment on table public.oauth_consents is 'KAN-88 — Per-user-per-client consent grants. Users see their own row in /dashboard/settings.';

-- ─── Trigger: updated_at on oauth_clients ────────────────────────────────

create or replace function public.oauth_clients_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger oauth_clients_updated_at
  before update on public.oauth_clients
  for each row execute function public.oauth_clients_set_updated_at();
