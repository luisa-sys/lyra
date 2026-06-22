-- KAN-309 / KAN-310 (+ SEC, see below): two-axis per-user access model for the
-- admin back-office.
--
-- WHAT
--   Adds two columns to public.profiles:
--     - access_stage  enum('waitlist','beta','live')  default 'waitlist'
--     - early_access  boolean                          default false
--   so the admin console can model the full lifecycle the founder asked for:
--     waitlisted signup -> enabled beta user -> launched ("live") user, with an
--     orthogonal "early access" (beta/experimental features) switch.
--     "Prod user WITH beta"    = access_stage='live' AND early_access=true
--     "Prod user WITHOUT beta"  = access_stage='live' AND early_access=false
--
--   Plus two SECURITY DEFINER admin-only RPCs the console reads:
--     - admin_list_users(...)        -> { rows: [...incl. auth.users.email], total }
--     - admin_filter_profile_ids(...) -> uuid[]  (server-side "select all matching filter")
--
-- GATE STRATEGY (deliberate, low-risk)
--   is_beta_eligible stays the single ENFORCED runtime gate (src/middleware.ts +
--   resolveBetaAccess). The new model DRIVES it: every admin transition writes
--   both new axes AND is_beta_eligible/beta_access_status together. No middleware
--   refactor in this release.
--
-- SECURITY (SEC, child of SEC-1)
--   The existing prevent_beta_self_elevation trigger only guarded the 4 legacy
--   beta columns. This migration extends it to also reject user-context changes
--   to access_stage / early_access, closing the same self-elevation class on the
--   new columns. Service role (auth.uid() IS NULL) / migrations still bypass.
--
-- APPLIED TO
--   dev (ilprytcrnqyrsbsrfujj): apply_migration 2026-06-22
--   staging (uobmlkzrjkptwhttzmmi) / prod (llzkgprqewuwkiwclowi): user-gated promotion.
--   NOTE: the beta-access columns + trigger are ALREADY live on all three envs
--   (the 20260620120000/100 migration headers say "NOT YET" but are stale). This
--   migration is additive on top of that live state.
--
-- ROLLBACK
--   drop function if exists public.admin_filter_profile_ids(text,text,boolean,boolean,boolean,int);
--   drop function if exists public.admin_list_users(text,text,boolean,boolean,boolean,int,int);
--   drop index if exists public.profiles_access_stage_idx;
--   alter table public.profiles drop column if exists early_access;
--   alter table public.profiles drop column if exists access_stage;
--   drop type if exists public.access_stage;
--   -- and restore prevent_beta_self_elevation() to the 4-column version from
--   -- 20260620120100_beta_access_lockdown.sql.

-- 1. enum -------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'access_stage') then
    create type public.access_stage as enum ('waitlist', 'beta', 'live');
  end if;
end $$;

-- 2. columns (additive, safe defaults) -------------------------------------
alter table public.profiles
  add column if not exists access_stage public.access_stage not null default 'waitlist',
  add column if not exists early_access boolean not null default false;

-- 3. backfill from the existing flags ---------------------------------------
-- Anyone already in the beta (legacy flag OR new status) -> beta + early access.
update public.profiles
   set access_stage = 'beta',
       early_access = true
 where access_stage = 'waitlist'
   and (is_beta_eligible = true or beta_access_status = 'approved');

-- Queued signups stay 'waitlist' (the default) — matches today's gate.
-- 'none' / non-eligible rows also stay 'waitlist'.

-- 4. index for the stage filter --------------------------------------------
create index if not exists profiles_access_stage_idx on public.profiles (access_stage);

-- 5. extend the self-elevation trigger to the new columns (SEC) -------------
create or replace function public.prevent_beta_self_elevation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Service role / backend jobs / migrations run without a user JWT
  -- (auth.uid() IS NULL) and ARE allowed to set the privileged columns.
  if auth.uid() is null then
    return new;
  end if;

  -- Any user-context request must NOT change the gate / access-model columns.
  if new.is_beta_eligible   is distinct from old.is_beta_eligible
  or new.beta_access_status is distinct from old.beta_access_status
  or new.beta_requested_at  is distinct from old.beta_requested_at
  or new.beta_approved_at   is distinct from old.beta_approved_at
  or new.access_stage       is distinct from old.access_stage
  or new.early_access       is distinct from old.early_access then
    raise exception 'access-control columns are admin-only (KAN-273 / KAN-309)'
      using errcode = '42501'; -- insufficient_privilege
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_prevent_beta_self_elevation on public.profiles;
create trigger profiles_prevent_beta_self_elevation
  before update on public.profiles
  for each row execute function public.prevent_beta_self_elevation();

-- 6. admin-only RPC: list signups with email + filters + pagination + count -
-- SECURITY DEFINER so it can join auth.users; guarded by an internal is_admin
-- check on auth.uid(). Called via the admin's COOKIE session (not service role),
-- so auth.uid() resolves. Granted to `authenticated` only (revoked from anon).
create or replace function public.admin_list_users(
  p_search    text    default null,
  p_stage     text    default null,
  p_early     boolean default null,
  p_suspended boolean default null,
  p_admin     boolean default null,
  p_limit     int     default 20,
  p_offset    int     default 0
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total  bigint;
  v_rows   json;
  v_limit  int  := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset int  := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not exists (
    select 1 from public.profiles
     where user_id = auth.uid() and is_admin = true
  ) then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select count(*) into v_total
    from public.profiles p
    join auth.users u on u.id = p.user_id
   where (v_search is null
          or u.email          ilike '%' || v_search || '%'
          or p.display_name   ilike '%' || v_search || '%'
          or p.slug           ilike '%' || v_search || '%')
     and (p_stage     is null or p.access_stage::text = p_stage)
     and (p_early     is null or p.early_access       = p_early)
     and (p_suspended is null or p.is_suspended       = p_suspended)
     and (p_admin     is null or p.is_admin           = p_admin);

  select coalesce(json_agg(r), '[]'::json) into v_rows
    from (
      select p.id,
             p.user_id,
             u.email,
             p.display_name,
             p.slug,
             p.created_at,
             p.access_stage,
             p.early_access,
             p.is_beta_eligible,
             p.beta_access_status,
             p.beta_requested_at,
             p.beta_approved_at,
             p.is_suspended,
             p.is_admin
        from public.profiles p
        join auth.users u on u.id = p.user_id
       where (v_search is null
              or u.email        ilike '%' || v_search || '%'
              or p.display_name ilike '%' || v_search || '%'
              or p.slug         ilike '%' || v_search || '%')
         and (p_stage     is null or p.access_stage::text = p_stage)
         and (p_early     is null or p.early_access       = p_early)
         and (p_suspended is null or p.is_suspended       = p_suspended)
         and (p_admin     is null or p.is_admin           = p_admin)
       order by p.created_at desc
       limit v_limit offset v_offset
    ) r;

  return json_build_object('rows', v_rows, 'total', v_total);
end;
$$;

-- 7. admin-only RPC: resolve the IDs matching a filter, capped --------------
-- Backs "select all N matching this filter" bulk actions: the IDs are
-- re-materialized SERVER-SIDE from the filter, never trusted from the client.
create or replace function public.admin_filter_profile_ids(
  p_search    text    default null,
  p_stage     text    default null,
  p_early     boolean default null,
  p_suspended boolean default null,
  p_admin     boolean default null,
  p_cap       int     default 500
)
returns uuid[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids    uuid[];
  v_cap    int  := least(greatest(coalesce(p_cap, 500), 1), 1000);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not exists (
    select 1 from public.profiles
     where user_id = auth.uid() and is_admin = true
  ) then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select array_agg(id) into v_ids
    from (
      select p.id
        from public.profiles p
        join auth.users u on u.id = p.user_id
       where (v_search is null
              or u.email        ilike '%' || v_search || '%'
              or p.display_name ilike '%' || v_search || '%'
              or p.slug         ilike '%' || v_search || '%')
         and (p_stage     is null or p.access_stage::text = p_stage)
         and (p_early     is null or p.early_access       = p_early)
         and (p_suspended is null or p.is_suspended       = p_suspended)
         and (p_admin     is null or p.is_admin           = p_admin)
       order by p.created_at desc
       limit v_cap
    ) s;

  return coalesce(v_ids, array[]::uuid[]);
end;
$$;

-- 8. grants: authenticated only (admins checked inside) ---------------------
revoke all on function public.admin_list_users(text,text,boolean,boolean,boolean,int,int) from public;
revoke all on function public.admin_filter_profile_ids(text,text,boolean,boolean,boolean,int) from public;
grant execute on function public.admin_list_users(text,text,boolean,boolean,boolean,int,int) to authenticated;
grant execute on function public.admin_filter_profile_ids(text,text,boolean,boolean,boolean,int) to authenticated;
