-- KAN-319 / KAN-255 / KAN-282: age-verification status (framework).
--
-- Adds per-user age_status so the env-wide AGE_VERIFICATION_REQUIRED switch can
-- gate profile publishing. Privacy-by-design: we store ONLY an age signal +
-- provider reference — NEVER a DOB, selfie, or raw biometric (KAN-282).
--
-- The real Didit hosted selfie flow that moves a user to 'passed' ships next
-- (KAN-282); this migration is the data model + the self-elevation guard.
--
-- SECURITY: age_status is set by the provider webhook (service role) or an admin
-- override (service role) only. A user must NEVER self-set age_status='passed'
-- (that would bypass the gate) — so we extend prevent_beta_self_elevation to
-- cover it (alongside the beta + access-model columns).
--
-- APPLIED TO: dev (ilprytcrnqyrsbsrfujj) 2026-06-22; staging/prod user-gated.
--
-- ROLLBACK:
--   alter table public.profiles drop column if exists age_provider_ref;
--   alter table public.profiles drop column if exists age_provider;
--   alter table public.profiles drop column if exists age_checked_at;
--   alter table public.profiles drop column if exists age_status;
--   drop type if exists public.age_status;
--   -- and restore prevent_beta_self_elevation() without the age_status clause.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'age_status') then
    create type public.age_status as enum ('none', 'pending', 'passed', 'failed', 'manual_review');
  end if;
end $$;

alter table public.profiles
  add column if not exists age_status public.age_status not null default 'none',
  add column if not exists age_checked_at timestamptz,
  add column if not exists age_provider text,
  add column if not exists age_provider_ref text;

-- Extend the self-elevation guard to the access-control columns this codebase
-- now has, including age_status. Service role / migrations (auth.uid() IS NULL)
-- bypass; any user-context change to these columns raises 42501.
create or replace function public.prevent_beta_self_elevation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
  or new.age_status         is distinct from old.age_status then
    raise exception 'access-control columns are admin-only (KAN-273 / KAN-309 / KAN-319)'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_prevent_beta_self_elevation on public.profiles;
create trigger profiles_prevent_beta_self_elevation
  before update on public.profiles
  for each row execute function public.prevent_beta_self_elevation();
