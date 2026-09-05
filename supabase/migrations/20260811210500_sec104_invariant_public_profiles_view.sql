-- SEC-104 / SEC-101 v3 — INV-8: the `public_profiles` view is the guard now, so
-- something has to check the guard.
--
-- WHY THIS MIGRATION EXISTS AT ALL
-- --------------------------------
-- SEC-104 moved `is_published = true AND is_suspended = false` out of eight
-- call sites and into a view body. That is a real improvement — a view WHERE
-- binds service_role, which RLS does not — but it MOVES the failure mode rather
-- than removing it:
--
--   * before, a unit test could read the call site and prove the filter existed;
--   * after, the filter lives in a database, and a unit test cannot see it.
--
-- So the repo's tests were narrowed to what they can honestly prove ("the code
-- reads the view") and THIS is the other half: a live, per-environment
-- assertion that the view on that database is actually what the code assumes.
-- Without it the guarantee would only be a comment, and dev/staging/production
-- could silently disagree — which is exactly the condition SEC-107 records for
-- the KAN-153 columns.
--
-- FAIL-CLOSED. A MISSING VIEW IS A VIOLATION.
-- The natural way to write this check is "if the view exists, verify it", which
-- reports clean on the one environment where the view was never applied — the
-- worst possible answer, because the code has already been cut over to read it.
-- INV-8 therefore fires when the view is ABSENT, when its definition has lost
-- either predicate, and when it is not security_invoker.
--
-- Note INV-7 does not cover the security_invoker case here: it only matches an
-- EXPLICIT `security_invoker=false`, and a view created without the option has
-- empty reloptions and defaults to invoker-off. INV-8 asserts the option is
-- positively present.
--
-- Invariants 1-7 are reproduced verbatim from v2 (read back from the live
-- database with pg_get_functiondef rather than copied from the v2 migration
-- file, so this replaces what is actually running).

create or replace function public.security_invariants_report()
returns table (invariant text, object_name text, detail text)
language sql
stable
set search_path to 'pg_catalog', 'public'
as $function$
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
  select 'INV-2-secdef-duplicate-overload'::text, obj,
         'SECURITY DEFINER function has more than one overload — a signature change leaves the old one behind and the new one inherits the anon/authenticated default grants'::text
    from secdef group by obj having count(*) > 1

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

  -- INV-8 (SEC-104). Three ways the public-visibility guard can be wrong, all
  -- reported against the same invariant so one waiver cannot silence a
  -- different failure than the one it was written for.
  union all
  select 'INV-8-public-profiles-view-missing'::text, 'public_profiles'::text,
         'SEC-104: the public_profiles view does not exist on this database, but the application reads it for every public profile surface'::text
   where not exists (
     select 1 from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'public_profiles' and c.relkind = 'v'
   )

  union all
  select 'INV-8-public-profiles-view-predicate'::text, 'public_profiles'::text,
         'SEC-104: the public_profiles view exists but its definition no longer constrains both is_published and is_suspended'::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'public_profiles' and c.relkind = 'v'
     and not (
          pg_get_viewdef(c.oid) ~* 'is_published'
      and pg_get_viewdef(c.oid) ~* 'is_suspended'
     )

  union all
  select 'INV-8-public-profiles-view-invoker'::text, 'public_profiles'::text,
         'SEC-104: the public_profiles view is not security_invoker=on, so it runs as its owner and bypasses RLS for every caller'::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'public_profiles' and c.relkind = 'v'
     and not exists (
       select 1 from unnest(coalesce(c.reloptions, '{}')) o where o ilike 'security_invoker=on'
     )

  order by 1, 2;
$function$;

comment on function public.security_invariants_report() is
  'SEC-101 v3: reports live violations of the eight database security invariants. '
  'v3 adds INV-8 (SEC-104): the public_profiles view must exist, must constrain '
  'both is_published and is_suspended, and must be security_invoker=on. It fires '
  'when the view is ABSENT, because the application reads that view for every '
  'public profile surface and a missing view is the worst case, not a clean one. '
  'Called by scripts/check-db-invariants.py.';

revoke all on function public.security_invariants_report() from public;
revoke all on function public.security_invariants_report() from anon;
revoke all on function public.security_invariants_report() from authenticated;
grant execute on function public.security_invariants_report() to service_role;
