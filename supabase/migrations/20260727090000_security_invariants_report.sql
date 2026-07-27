-- SEC-101: live database security-invariant reporter.
--
-- WHY
-- ---
-- Postgres privilege drift is Lyra's most recurrent security defect class:
-- SEC-12, SEC-15, SEC-27, SEC-28, SEC-29, SEC-42, SEC-43, BUGS-48, BUGS-65,
-- BUGS-69 are all the same mechanism. `CREATE FUNCTION` grants EXECUTE to
-- PUBLIC by default (which in Supabase includes `anon` and `authenticated`),
-- and `CREATE OR REPLACE` RESETS the ACL back to that default — so a one-off
-- REVOKE protects only the functions that existed when it ran.
--
-- `scripts/check-migration-privileges.py` catches this before merge. But
-- migrations here are applied with the Supabase MCP `apply_migration` tool,
-- so DDL can and does reach a database without ever passing through a PR.
-- SEC-42 is exactly that: a grant restored by a later migration *after*
-- SEC-29 had been closed. A repo-only control cannot see it.
--
-- This function is the live backstop. It reports, for the database it runs
-- in, every violation of the seven invariants below. It is called by
-- `scripts/check-db-invariants.py` against dev, staging and production, and
-- is wired into `.github/workflows/db-invariants.yml`.
--
-- THE INVARIANTS
--   INV-1  no SECURITY DEFINER function is EXECUTE-able by `anon`
--   INV-2  no SECURITY DEFINER function has a NULL ACL (= PUBLIC default EXECUTE)
--   INV-3  every SECURITY DEFINER function pins its search_path
--   INV-4  a SECURITY DEFINER function EXECUTE-able by `authenticated` must
--          perform its own authorization check in the body
--   INV-5  every table in `public` has row-level security enabled
--   INV-6  no storage bucket is world-readable
--   INV-7  no view in `public` is defined SECURITY DEFINER
--
-- SECURITY NOTE
-- -------------
-- Deliberately SECURITY INVOKER, not DEFINER. Everything it reads
-- (pg_catalog, storage.buckets) is already readable by `service_role`, so
-- there is no reason to add another elevated function to the very set this
-- is policing. EXECUTE is revoked from PUBLIC/anon/authenticated and granted
-- only to `service_role`.
--
-- Returns zero rows on a healthy database.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.security_invariants_report();

create or replace function public.security_invariants_report()
returns table (invariant text, object_name text, detail text)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with secdef as (
    select p.oid,
           p.proname::text as obj,
           p.proacl,
           p.proconfig,
           pg_get_functiondef(p.oid) as def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
  )
  select 'INV-1-secdef-anon-execute'::text, obj,
         'anon holds EXECUTE on a SECURITY DEFINER function'::text
    from secdef where has_function_privilege('anon', oid, 'EXECUTE')

  union all
  select 'INV-2-secdef-null-acl'::text, obj,
         'NULL ACL means PUBLIC retains the default EXECUTE grant'::text
    from secdef where proacl is null

  union all
  select 'INV-3-secdef-unpinned-search-path'::text, obj,
         'SECURITY DEFINER function without SET search_path'::text
    from secdef where proconfig is null

  union all
  select 'INV-4-secdef-authed-execute-no-authz'::text, obj,
         'authenticated holds EXECUTE but the body performs no authorization check'::text
    from secdef
   where has_function_privilege('authenticated', oid, 'EXECUTE')
     and def !~* '(is_admin|auth\.uid\(\)|auth\.role\(\)|has_role|request\.jwt)'

  union all
  select 'INV-5-table-rls-disabled'::text, c.relname::text,
         'public table with row-level security disabled'::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity

  union all
  select 'INV-6-public-storage-bucket'::text, b.id::text,
         'storage bucket is world-readable (public = true)'::text
    from storage.buckets b where b.public

  union all
  select 'INV-7-secdef-view'::text, c.relname::text,
         'view in public is defined SECURITY DEFINER'::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and exists (
       select 1 from unnest(coalesce(c.reloptions, '{}')) o
        where o ilike 'security_invoker=false' or o ilike 'security_definer%'
     )

  order by 1, 2;
$$;

comment on function public.security_invariants_report() is
  'SEC-101: reports live violations of the seven database security invariants. '
  'Read-only, SECURITY INVOKER, service_role only. Zero rows = healthy. '
  'Called by scripts/check-db-invariants.py.';

-- The function must not be callable by untrusted roles: it enumerates the
-- security posture of the database.
revoke all on function public.security_invariants_report() from public;
revoke all on function public.security_invariants_report() from anon;
revoke all on function public.security_invariants_report() from authenticated;
grant execute on function public.security_invariants_report() to service_role;
