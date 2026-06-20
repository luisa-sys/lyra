-- KAN-273 hardening: beta-access columns are admin-only at the DB layer.
--
-- THREAT: the only UPDATE policy on profiles ("Update own profile",
-- auth.uid() = user_id) plus a table-level UPDATE grant to `authenticated`
-- means a signed-in user can run a direct Supabase call to set their OWN
-- is_beta_eligible=true / beta_access_status='approved' and self-approve into
-- the beta, bypassing the entire gate. The app's ALLOWED_PROFILE_FIELDS
-- allowlist only guards the UI, not the database.
--
-- FIX: a BEFORE UPDATE trigger that rejects any change to the four privileged
-- beta columns unless the caller has no user JWT (auth.uid() IS NULL) — i.e.
-- the service role (admin approval via getAdminServiceClient, and the signup
-- callback's service-role "requested" write) or a SQL migration. Normal
-- user profile edits (which never touch these columns) are unaffected.
--
-- Applied to:
--   dev (ilprytcrnqyrsbsrfujj): via apply_migration 2026-06-20
--   staging / prod: NOT YET — user-gated promotion (epic KAN-273).
--   NOTE: this also closes the pre-existing self-approve hole on the legacy
--   is_beta_eligible flag, so it is safe + desirable to promote with the rest.
--
-- Rollback:
--   drop trigger if exists profiles_prevent_beta_self_elevation on public.profiles;
--   drop function if exists public.prevent_beta_self_elevation();

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

  -- Any user-context request must NOT change the gate columns.
  if new.is_beta_eligible   is distinct from old.is_beta_eligible
  or new.beta_access_status is distinct from old.beta_access_status
  or new.beta_requested_at  is distinct from old.beta_requested_at
  or new.beta_approved_at   is distinct from old.beta_approved_at then
    raise exception 'beta-access columns are admin-only (KAN-273)'
      using errcode = '42501'; -- insufficient_privilege
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_prevent_beta_self_elevation on public.profiles;
create trigger profiles_prevent_beta_self_elevation
  before update on public.profiles
  for each row execute function public.prevent_beta_self_elevation();
