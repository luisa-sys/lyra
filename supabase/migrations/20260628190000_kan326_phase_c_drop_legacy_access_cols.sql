-- KAN-326 Phase C — drop the redundant legacy access-state columns.
--
-- user_status + access_tier are the SOLE source of truth for the access model.
-- The four legacy state columns (access_stage, early_access, is_beta_eligible,
-- beta_access_status) duplicated that state and were written in lockstep; the
-- web app (computeAccessTransition, beta-queue approve, resolveBetaAccess, admin
-- pages) no longer reads or writes them. This migration re-points the three DB
-- objects that still referenced them, then drops the columns.
--
-- KEPT: beta_requested_at / beta_approved_at — these are audit timestamps, not
-- redundant state. resolveBetaAccess now keys the one-shot waitlist notice off
-- beta_requested_at IS NULL.
--
-- Order matters: rewrite the functions FIRST (so nothing references the columns),
-- THEN drop the columns. The two indexes (profiles_access_stage_idx,
-- profiles_beta_access_requested_idx) and the column defaults cascade with DROP
-- COLUMN. CREATE OR REPLACE preserves each function's existing ACL, so the SEC-29
-- EXECUTE revoke on the admin RPCs is retained.
--
-- Rollback: re-add the columns nullable, backfill from user_status/access_tier
--   (waitlist→access_stage='waitlist'; live+beta→'beta'; live+prod→'live'), and
--   restore the prior function bodies from git history.

-- ── 1. Self-elevation guard: drop the 4 legacy-col checks (user_status /
--       access_tier / age_status / the audit timestamps stay guarded). ─────────
create or replace function public.prevent_beta_self_elevation()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.beta_requested_at is distinct from old.beta_requested_at
  or new.beta_approved_at  is distinct from old.beta_approved_at
  or new.user_status       is distinct from old.user_status
  or new.access_tier       is distinct from old.access_tier
  or new.age_status        is distinct from old.age_status then
    raise exception 'access-control columns are admin-only (KAN-273 / KAN-309 / KAN-319 / status-model)'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

-- ── 2. admin_list_users: remap the p_stage filter to user_status/access_tier,
--       make p_early a no-op (signature kept), drop legacy cols from the JSON. ──
create or replace function public.admin_list_users(p_search text default null::text, p_stage text default null::text, p_early boolean default null::boolean, p_suspended boolean default null::boolean, p_admin boolean default null::boolean, p_limit integer default 20, p_offset integer default 0)
 returns json
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
     and (p_stage is null
          or (p_stage = 'waitlist' and p.user_status = 'waitlist')
          or (p_stage = 'beta'     and p.user_status = 'live' and p.access_tier = 'beta')
          or (p_stage = 'live'     and p.user_status = 'live' and p.access_tier = 'prod'))
     -- p_early kept for signature compatibility; early_access dropped (Phase C) → no-op
     and (p_suspended is null or p.is_suspended = p_suspended)
     and (p_admin     is null or p.is_admin     = p_admin);

  select coalesce(json_agg(r), '[]'::json) into v_rows
    from (
      select p.id,
             p.user_id,
             u.email,
             p.display_name,
             p.slug,
             p.created_at,
             p.user_status,
             p.access_tier,
             p.is_published,
             p.age_status,
             p.beta_requested_at,
             p.beta_approved_at,
             p.is_suspended,
             p.is_admin,
             exists (
               select 1 from public.feature_entitlements fe
                where fe.profile_id = p.id
                  and fe.enabled = false
                  and fe.feature_key in ('media_uploads', 'discovery')
             ) as has_revoked_ga_feature
        from public.profiles p
        join auth.users u on u.id = p.user_id
       where (v_search is null
              or u.email        ilike '%' || v_search || '%'
              or p.display_name ilike '%' || v_search || '%'
              or p.slug         ilike '%' || v_search || '%')
         and (p_stage is null
              or (p_stage = 'waitlist' and p.user_status = 'waitlist')
              or (p_stage = 'beta'     and p.user_status = 'live' and p.access_tier = 'beta')
              or (p_stage = 'live'     and p.user_status = 'live' and p.access_tier = 'prod'))
         and (p_suspended is null or p.is_suspended = p_suspended)
         and (p_admin     is null or p.is_admin     = p_admin)
       order by p.created_at desc
       limit v_limit offset v_offset
    ) r;

  return json_build_object('rows', v_rows, 'total', v_total);
end;
$function$;

-- ── 3. admin_filter_profile_ids: same p_stage remap, p_early no-op. ───────────
create or replace function public.admin_filter_profile_ids(p_search text default null::text, p_stage text default null::text, p_early boolean default null::boolean, p_suspended boolean default null::boolean, p_admin boolean default null::boolean, p_cap integer default 500)
 returns uuid[]
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
         and (p_stage is null
              or (p_stage = 'waitlist' and p.user_status = 'waitlist')
              or (p_stage = 'beta'     and p.user_status = 'live' and p.access_tier = 'beta')
              or (p_stage = 'live'     and p.user_status = 'live' and p.access_tier = 'prod'))
         and (p_suspended is null or p.is_suspended = p_suspended)
         and (p_admin     is null or p.is_admin     = p_admin)
       order by p.created_at desc
       limit v_cap
    ) s;

  return coalesce(v_ids, array[]::uuid[]);
end;
$function$;

-- ── 4. Drop the redundant legacy state columns (indexes + defaults cascade). ──
alter table public.profiles
  drop column if exists access_stage,
  drop column if exists early_access,
  drop column if exists is_beta_eligible,
  drop column if exists beta_access_status;
