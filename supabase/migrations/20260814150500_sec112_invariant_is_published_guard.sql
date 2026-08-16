-- SEC-112 / SEC-101 v4 — INV-9: the `is_published` guard trigger must actually
-- exist on this database.
--
-- WHY A LIVE CHECK AND NOT JUST A UNIT TEST
-- -----------------------------------------
-- The repo can prove that `20260814150000_sec112_block_is_published_self_set.sql`
-- says the right thing. It cannot prove the trigger is RUNNING. Lyra applies
-- schema changes with the Supabase MCP `apply_migration` tool (CLAUDE.md gotcha
-- #9), so DDL reaches a database without passing through a pull request — and a
-- later migration can drop or replace a trigger with nothing in the repo going
-- red. That is SEC-42's exact shape, and this family (SEC-12/15/27/28/29/42/43,
-- BUGS-48/65/69) has been fixed-then-silently-reopened nine times.
--
-- It matters more than usual here because SEC-112's protection is ONLY the
-- trigger. The migration deliberately ships no column revoke: a column-level
-- REVOKE cannot subtract from the table-level UPDATE grant `authenticated`
-- holds, so SEC-27's "defence in depth" line has been inert since 2026-06-22
-- (measured 2026-08-14 — pg_attribute.attacl is NULL for every column on prod).
-- With no second layer, the trigger going missing is the whole control going
-- missing.
--
-- FAIL-CLOSED. AN ABSENT TRIGGER IS A VIOLATION.
-- Written so that "the trigger is not there" fires, rather than the tempting
-- "if it exists, check it" shape that reports clean on precisely the
-- environment where the migration was never applied — the worst possible
-- answer, because the application has already been cut over to rely on it.
--
-- Two separate invariant keys, so a waiver written for one cannot silence the
-- other:
--   INV-9-is-published-guard-missing   the trigger is absent (or disabled)
--   INV-9-is-published-guard-predicate the trigger exists but its function body
--                                      no longer mentions is_published, i.e. it
--                                      was replaced by something that no longer
--                                      guards the column it is named for
--
-- The `tgenabled` check is not padding: `ALTER TABLE ... DISABLE TRIGGER` leaves
-- the row in pg_trigger, so an existence-only test would pass a disabled
-- trigger. 'O' is "enabled, origin" — the normal state.
--
-- Invariants 1-8 are reproduced VERBATIM from the live database
-- (pg_get_functiondef, read back from prod 2026-08-14, md5 afd0d87c… and
-- byte-identical on dev) rather than copied from the v3 migration file, so this
-- replaces what is actually running.

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

  -- INV-9 (SEC-112). The is_published self-write guard. Fires when ABSENT,
  -- because the trigger is the ONLY layer protecting the column.
  union all
  select 'INV-9-is-published-guard-missing'::text, 'profiles'::text,
         'SEC-112: profiles_block_is_published_self_set is absent or disabled, so any authenticated user can PATCH is_published on their own row via PostgREST and publish without passing the KAN-408 age gate'::text
   where not exists (
     select 1 from pg_trigger t
      where t.tgrelid = 'public.profiles'::regclass
        and t.tgname = 'profiles_block_is_published_self_set'
        and not t.tgisinternal
        and t.tgenabled = 'O'
   )

  union all
  select 'INV-9-is-published-guard-predicate'::text, 'profiles'::text,
         'SEC-112: profiles_block_is_published_self_set exists but its function body no longer references is_published, or no longer exempts service-role callers via auth.uid() IS NULL'::text
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'public.profiles'::regclass
     and t.tgname = 'profiles_block_is_published_self_set'
     and not t.tgisinternal
     and not (
          pg_get_functiondef(p.oid) ~* 'is_published'
      and pg_get_functiondef(p.oid) ~* 'auth\.uid\(\) is null'
     )

  order by 1, 2;
$function$;

comment on function public.security_invariants_report() is
  'SEC-101 v4: reports live violations of the nine database security invariants. '
  'v4 adds INV-9 (SEC-112): the profiles_block_is_published_self_set BEFORE UPDATE '
  'trigger must exist, be enabled, reference is_published, and retain the '
  'auth.uid() IS NULL service-role exemption. It fires when the trigger is ABSENT '
  'or DISABLED, because that trigger is the only layer protecting the column — '
  'the column-level revoke used elsewhere is inert against the table-level UPDATE '
  'grant authenticated holds. Called by scripts/check-db-invariants.py.';

revoke all on function public.security_invariants_report() from public;
revoke all on function public.security_invariants_report() from anon;
revoke all on function public.security_invariants_report() from authenticated;
grant execute on function public.security_invariants_report() to service_role;
