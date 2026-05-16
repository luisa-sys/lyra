-- KAN-205 — Convene Phase 1: identity & consent layer.
--
-- Real data model that replaces the P0 spike. Three tables:
--
--   oauth_connections        canonical per-user-per-provider account record
--   oauth_scopes_granted     append-only history of scope grants/revokes
--   consent_log              append-only audit trail for GDPR / UK-DPA
--
-- All RLS-enforced from day one. Service-role bypasses RLS by design — every
-- Convene MCP tool must chain explicit `.eq('owner_user_id', userId)` (enforced
-- by a static-grep guard test that lands later in P1).
--
-- The P0 `convene_spike_oauth_connections` table is left in place for now and
-- dropped in the final P1 migration once the spike routes are removed.

-- ─── oauth_connections ────────────────────────────────────────────────────

create table public.oauth_connections (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft', 'apple', 'caldav_generic')),
  provider_account_id text not null,
  display_name text,
  refresh_token_secret_id uuid not null,
  access_token_secret_id uuid,
  access_token_expires_at timestamptz,
  scope_granted text not null,
  status text not null default 'active' check (status in ('active', 'revoked', 'error')),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (owner_user_id, provider, provider_account_id)
);

create index oauth_connections_owner_idx on public.oauth_connections (owner_user_id) where deleted_at is null;

alter table public.oauth_connections enable row level security;

create policy oauth_connections_owner_select on public.oauth_connections
  for select using (auth.uid() = owner_user_id);

create policy oauth_connections_owner_insert on public.oauth_connections
  for insert with check (auth.uid() = owner_user_id);

create policy oauth_connections_owner_update on public.oauth_connections
  for update using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

create policy oauth_connections_owner_delete on public.oauth_connections
  for delete using (auth.uid() = owner_user_id);

comment on table public.oauth_connections is 'KAN-205 — per-user-per-provider OAuth account. refresh_token_secret_id refs Supabase Vault.';
comment on column public.oauth_connections.provider_account_id is 'Provider-specific stable account id (Google sub claim, MS oid, etc.). Detects "connected the same account twice".';

-- ─── oauth_scopes_granted ─────────────────────────────────────────────────

create table public.oauth_scopes_granted (
  id uuid primary key default gen_random_uuid(),
  oauth_connection_id uuid not null references public.oauth_connections(id) on delete cascade,
  scope text not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index oauth_scopes_granted_connection_idx on public.oauth_scopes_granted (oauth_connection_id) where revoked_at is null;

alter table public.oauth_scopes_granted enable row level security;

-- Read via the owning connection; the connection's RLS gates access.
create policy oauth_scopes_granted_via_connection_select on public.oauth_scopes_granted
  for select using (
    exists (
      select 1 from public.oauth_connections c
      where c.id = oauth_connection_id and c.owner_user_id = auth.uid()
    )
  );

-- Writes only from service-role (no policy for insert/update/delete from
-- authenticated). Audit append happens server-side only.

comment on table public.oauth_scopes_granted is 'KAN-205 — append-only history of OAuth scope grants. Service-role writes only.';

-- ─── consent_log ──────────────────────────────────────────────────────────

create table public.consent_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in (
    'oauth_granted',
    'oauth_revoked',
    'scope_added',
    'scope_removed',
    'contact_import_started',
    'contact_import_completed',
    'contact_import_cancelled',
    'tribe_only_disclosure',
    'gathering_invite_sent',
    'rsvp_recorded'
  )),
  subject_kind text,
  subject_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index consent_log_user_created_idx on public.consent_log (user_id, created_at desc);

alter table public.consent_log enable row level security;

create policy consent_log_owner_select on public.consent_log
  for select using (auth.uid() = user_id);

-- Append-only: no update or delete policy. Service-role writes only.

-- Enforce append-only at the DB level too (defence-in-depth).
create or replace function public.consent_log_block_mutations()
  returns trigger
  language plpgsql
as $$
begin
  raise exception 'consent_log is append-only (KAN-205 — GDPR audit trail)';
end;
$$;

create trigger consent_log_no_update before update on public.consent_log
  for each row execute function public.consent_log_block_mutations();

create trigger consent_log_no_delete before delete on public.consent_log
  for each row execute function public.consent_log_block_mutations();

comment on table public.consent_log is 'KAN-205 — append-only audit trail of user consent events. Required for GDPR / UK-DPA.';

-- ─── updated_at trigger (shared helper) ───────────────────────────────────

create or replace function public.convene_set_updated_at()
  returns trigger
  language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger oauth_connections_updated_at before update on public.oauth_connections
  for each row execute function public.convene_set_updated_at();
