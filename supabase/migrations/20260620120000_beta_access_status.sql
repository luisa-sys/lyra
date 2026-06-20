-- KAN-275 (epic KAN-273): Beta-access lifecycle on profiles.
--
-- The queue/approval flow records each user's beta-access lifecycle:
--   none -> requested -> approved
-- Additive + forward-only; no destructive ops. Coexists with the legacy
-- `is_beta_eligible` flag, which the approval flow continues to set during
-- the transition.
--
-- Applied to:
--   dev (ilprytcrnqyrsbsrfujj): via apply_migration 2026-06-20
--   staging / prod: NOT YET — user-gated promotion (epic KAN-273).
--
-- Rollback:
--   drop index if exists public.profiles_beta_access_requested_idx;
--   alter table public.profiles
--     drop column if exists beta_access_status,
--     drop column if exists beta_requested_at,
--     drop column if exists beta_approved_at;
--   drop type if exists public.beta_access_status;

-- 1. Enum type (guarded — Postgres has no `create type if not exists`).
do $$
begin
  if not exists (select 1 from pg_type where typname = 'beta_access_status') then
    create type public.beta_access_status as enum ('none', 'requested', 'approved');
  end if;
end$$;

-- 2. Columns on profiles (additive; status NOT NULL default 'none').
alter table public.profiles
  add column if not exists beta_access_status public.beta_access_status not null default 'none',
  add column if not exists beta_requested_at timestamptz,
  add column if not exists beta_approved_at  timestamptz;

-- 3. Backfill: existing beta-eligible users are already "approved".
update public.profiles
set beta_access_status = 'approved',
    beta_approved_at = coalesce(beta_approved_at, now())
where is_beta_eligible = true
  and beta_access_status = 'none';

-- 4. Partial index for the admin queue listing (only 'requested' rows).
create index if not exists profiles_beta_access_requested_idx
  on public.profiles (beta_access_status)
  where beta_access_status = 'requested';

comment on column public.profiles.beta_access_status is
  'KAN-275: beta-access lifecycle none|requested|approved. Set server-side on signup (requested) and admin approval (approved). Coexists with is_beta_eligible during transition.';
