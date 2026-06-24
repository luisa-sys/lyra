-- KAN-326 / KAN-327: Clean access model — add user_status + access_tier (additive, backfilled).
-- Collapses the overlapping lifecycle fields into two clear axes:
--   user_status: not_applied -> waitlist -> live   (was: beta_access_status none/requested/approved)
--   access_tier: beta | prod                       (was: access_stage live-vs-beta split)
-- Legacy columns (is_beta_eligible, beta_access_status, access_stage, early_access) are KEPT for
-- the transition and dropped in a follow-up migration once all code reads/writes the new columns.

create type public.user_status as enum ('not_applied', 'waitlist', 'live');
create type public.access_tier as enum ('beta', 'prod');

alter table public.profiles
  add column user_status public.user_status not null default 'waitlist',
  add column access_tier public.access_tier not null default 'beta';

-- One-time backfill from legacy fields
update public.profiles set
  user_status = case beta_access_status
    when 'approved'  then 'live'::public.user_status
    when 'requested' then 'waitlist'::public.user_status
    when 'none'      then 'not_applied'::public.user_status
    else 'waitlist'::public.user_status
  end,
  access_tier = case
    when access_stage = 'live' then 'prod'::public.access_tier
    else 'beta'::public.access_tier
  end;

-- Extend the self-elevation guard to cover the new admin-only columns
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

  if new.is_beta_eligible   is distinct from old.is_beta_eligible
  or new.beta_access_status is distinct from old.beta_access_status
  or new.beta_requested_at  is distinct from old.beta_requested_at
  or new.beta_approved_at   is distinct from old.beta_approved_at
  or new.access_stage       is distinct from old.access_stage
  or new.early_access       is distinct from old.early_access
  or new.user_status        is distinct from old.user_status
  or new.access_tier        is distinct from old.access_tier
  or new.age_status         is distinct from old.age_status then
    raise exception 'access-control columns are admin-only (KAN-273 / KAN-309 / KAN-319 / status-model)'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

comment on column public.profiles.user_status is 'Lifecycle: not_applied -> waitlist -> live. Replaces beta_access_status. Admin-only (trigger-guarded).';
comment on column public.profiles.access_tier is 'Which site + test-feature default: beta or prod. Replaces the live/beta split of access_stage. Admin-only (trigger-guarded).';
