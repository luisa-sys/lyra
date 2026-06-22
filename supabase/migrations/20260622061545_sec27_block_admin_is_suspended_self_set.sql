-- SEC-27 (CRITICAL): block authenticated/anon self-elevation of is_admin and
-- self-unsuspension of is_suspended on public.profiles.
--
-- Root cause: the "Update own profile" RLS policy (auth.uid() = user_id) allows a
-- user to UPDATE *any* column of their own row, and prevent_beta_self_elevation
-- only guarded the beta columns. Both `authenticated` and `anon` also hold a
-- column-level UPDATE grant on is_admin/is_suspended. Net effect: any signed-in
-- user could PATCH {"is_admin": true} (full admin privesc) or {"is_suspended":
-- false} (self-unsuspend) via PostgREST. Discovered by the daily security check
-- (B6) on 2026-06-22; the expected blocking trigger had never been created in any
-- environment.
--
-- Fix: a BEFORE UPDATE trigger that raises 42501 if a JWT-bearing caller
-- (auth.uid() IS NOT NULL) changes either column. Service-role / backend callers
-- (auth.uid() IS NULL) are unaffected, so the admin console's service-role writes
-- (see src/app/admin/users/actions.ts — "service role passes the admin-only
-- trigger") and the beta/suspension approval flows continue to work.
--
-- Applied live (idempotent) to dev/staging/prod via the Supabase MCP on
-- 2026-06-22 and verified on all three: an authenticated UPDATE of either column
-- raises 42501, a service-role UPDATE still succeeds.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS profiles_block_admin_is_suspended_self_set ON public.profiles;
--   DROP FUNCTION IF EXISTS public.block_admin_is_suspended_self_set();

CREATE OR REPLACE FUNCTION public.block_admin_is_suspended_self_set()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Service role / backend (no JWT subject): allow.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  -- JWT-bearing (authenticated/anon) caller: is_admin and is_suspended are
  -- admin-only columns — reject any attempt to change them.
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin
  OR NEW.is_suspended IS DISTINCT FROM OLD.is_suspended THEN
    RAISE EXCEPTION 'is_admin and is_suspended are admin-only columns'
      USING errcode = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_block_admin_is_suspended_self_set ON public.profiles;
CREATE TRIGGER profiles_block_admin_is_suspended_self_set
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.block_admin_is_suspended_self_set();
