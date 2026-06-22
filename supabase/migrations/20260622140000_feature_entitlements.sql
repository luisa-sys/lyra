-- KAN-309 follow-on: per-user feature entitlements.
--
-- WHAT
--   A per-user, per-feature on/off table so the admin back-office can switch
--   beta features ON/OFF for individual users: Convene, MCP, paid gift links,
--   Convene paid channels (SMS/WhatsApp), media uploads, discovery.
--
--   Effective gate at every call site is:  ENV_FLAG && isFeatureEnabled(user, key)
--   The per-ENV flag (CONVENE_ENABLED, SOVRN_API_KEY, ...) stays the master
--   kill-switch; this table is the per-user cohort. A flip here does NOTHING
--   until the env flag is also on (keeps dormant features dormant).
--
--   Per-key DEFAULTS live in TS (src/lib/features/registry.ts), not here:
--   isFeatureEnabled returns the row's `enabled` when a row exists, else the
--   key's default. So "default-off beta" keys (convene/paid_gift_links/mcp/
--   convene_paid_channels) need no row to be off, and "default-on revocable"
--   keys (media_uploads/discovery) need no row to be on. Only explicit
--   admin grants/revokes write rows.
--
-- SECURITY (mirrors SEC-24 / BUGS-28 — a paid_gift_links self-grant unlocks money)
--   - writes are SERVICE-ROLE ONLY: REVOKE write privs + RLS (no write policy)
--     + a BEFORE trigger that rejects any auth.uid()-context write (42501).
--   - SELECT: a user reads only their own rows; admins read all.
--
-- APPLIED TO
--   dev (ilprytcrnqyrsbsrfujj): apply_migration 2026-06-22.
--   staging/prod: user-gated promotion. HARD PREREQUISITE: SEC-24
--   (prevent_beta_self_elevation extension) must be live on staging+prod first.
--
-- ROLLBACK
--   drop table if exists public.feature_entitlements cascade;
--   drop function if exists public.prevent_feature_entitlement_self_grant();

create table if not exists public.feature_entitlements (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  feature_key text not null,
  enabled     boolean not null default true,
  metadata    jsonb,
  granted_by  uuid references public.profiles(id),
  granted_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (profile_id, feature_key)
);

create index if not exists feature_entitlements_enabled_idx
  on public.feature_entitlements (feature_key) where enabled;
create index if not exists feature_entitlements_profile_idx
  on public.feature_entitlements (profile_id);

-- Backfill: keep existing MCP key holders working (mcp defaults OFF in the
-- registry, so without this they'd lose write-tool access).
insert into public.feature_entitlements (profile_id, feature_key, enabled)
select distinct p.id, 'mcp', true
  from public.profiles p
 where exists (select 1 from public.api_keys k where k.user_id = p.user_id)
on conflict (profile_id, feature_key) do nothing;

-- Self-grant guard: only service-role / migrations (auth.uid() IS NULL) may write.
create or replace function public.prevent_feature_entitlement_self_grant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null then
    raise exception 'feature_entitlements are admin-only (KAN-309)'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists feature_entitlements_no_self_grant on public.feature_entitlements;
create trigger feature_entitlements_no_self_grant
  before insert or update or delete on public.feature_entitlements
  for each row execute function public.prevent_feature_entitlement_self_grant();

-- RLS: owner-read + admin-read; NO write policy (writes are service-role only).
alter table public.feature_entitlements enable row level security;

drop policy if exists "owner reads own entitlements" on public.feature_entitlements;
create policy "owner reads own entitlements"
  on public.feature_entitlements for select to authenticated
  using (exists (
    select 1 from public.profiles p
     where p.id = feature_entitlements.profile_id and p.user_id = auth.uid()
  ));

drop policy if exists "admins read all entitlements" on public.feature_entitlements;
create policy "admins read all entitlements"
  on public.feature_entitlements for select to authenticated
  using (exists (
    select 1 from public.profiles p
     where p.user_id = auth.uid() and p.is_admin = true
  ));

-- Defense in depth: strip write privileges from the user-facing roles.
revoke insert, update, delete on public.feature_entitlements from authenticated, anon;
