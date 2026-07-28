-- KAN-204 — Convene Phase 0 OAuth spike.
-- THROWAWAY. Apply to dev Supabase only. Reverted before P1 (KAN-205) lands.
--
-- Adds:
--   - convene_spike_oauth_connections table (no RLS — service-role-only writes)
--   - Three vault helper functions (convene_vault_*) used by the spike code
--     and reused by P1.
--
-- DO NOT promote this migration through staging or production. P1 will
-- introduce the real `oauth_connections` table with full RLS.

-- ─── Vault helpers ────────────────────────────────────────────────────────

create or replace function public.convene_vault_store_secret(
  p_secret text,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = vault, public
as $$
declare
  v_id uuid;
begin
  v_id := vault.create_secret(p_secret, null, p_description);
  return v_id;
end;
$$;

create or replace function public.convene_vault_read_secret(
  p_secret_id uuid
)
returns text
language plpgsql
security definer
set search_path = vault, public
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where id = p_secret_id;
  return v_secret;
end;
$$;

create or replace function public.convene_vault_revoke_secret(
  p_secret_id uuid
)
returns void
language plpgsql
security definer
set search_path = vault, public
as $$
begin
  delete from vault.secrets where id = p_secret_id;
end;
$$;

-- Only the service role should ever call these.
revoke execute on function public.convene_vault_store_secret(text, text) from anon, authenticated;
revoke execute on function public.convene_vault_read_secret(uuid) from anon, authenticated;
revoke execute on function public.convene_vault_revoke_secret(uuid) from anon, authenticated;

-- ─── Spike connections table ──────────────────────────────────────────────

create table if not exists public.convene_spike_oauth_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google')),
  refresh_token_secret_id uuid not null,
  scope_granted text not null,
  created_at timestamptz not null default now(),
  unique (user_id, provider)
);

-- Service-role only — spike doesn't expose to anon/authenticated. P1 replaces
-- this with a proper RLS-enforced oauth_connections table.
alter table public.convene_spike_oauth_connections enable row level security;
-- No policies = deny-all for anon/authenticated. Service role bypasses RLS.

comment on table public.convene_spike_oauth_connections is
  'KAN-204 spike — throwaway. Replaced by public.oauth_connections in KAN-205.';
