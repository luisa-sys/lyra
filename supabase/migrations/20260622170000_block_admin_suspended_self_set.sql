-- SEC-27 [CRITICAL]: is_admin / is_suspended self-elevation.
--
-- THREAT: the "Update own profile" RLS policy (auth.uid() = user_id, no WITH
-- CHECK) + the table-level UPDATE grant to `authenticated` let ANY signed-in
-- user PATCH their own row to set is_admin=true (full admin escalation) or
-- is_suspended=false (self-unsuspend). prevent_beta_self_elevation guards the
-- beta/access/age columns but NOT these two. Discovered by the daily security
-- check (B6 probe) 2026-06-22; affects dev/staging/prod.
--
-- FIX: a dedicated BEFORE UPDATE trigger that rejects any user-context change to
-- is_admin / is_suspended (service role / migrations — auth.uid() IS NULL —
-- bypass, so admin approval + suspend/unsuspend via getAdminServiceClient still
-- work). Named exactly as the B6 daily probe expects
-- (profiles_block_admin_is_suspended_self_set).
--
-- This also makes the KAN-319 suspend-outright feature actually enforceable: a
-- suspended user can no longer self-unsuspend.
--
-- APPLIED: dev (ilprytcrnqyrsbsrfujj) 2026-06-22; staging/prod with this push.
--
-- ROLLBACK:
--   drop trigger if exists profiles_block_admin_is_suspended_self_set on public.profiles;
--   drop function if exists public.block_admin_is_suspended_self_set();

create or replace function public.block_admin_is_suspended_self_set()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.is_admin     is distinct from old.is_admin
  or new.is_suspended is distinct from old.is_suspended then
    raise exception 'is_admin and is_suspended are admin-only columns (SEC-27)'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_block_admin_is_suspended_self_set on public.profiles;
create trigger profiles_block_admin_is_suspended_self_set
  before update on public.profiles
  for each row execute function public.block_admin_is_suspended_self_set();

-- Defence in depth: strip column-level UPDATE on these from the user roles.
revoke update (is_admin, is_suspended) on public.profiles from authenticated, anon;
