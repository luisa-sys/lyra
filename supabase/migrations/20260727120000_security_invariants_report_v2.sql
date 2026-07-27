-- SEC-101 v2: correct two defects in security_invariants_report().
--
-- WHY THIS SUPERSEDES 20260727090000
-- ----------------------------------
-- The v1 function shipped on 2026-07-27 with a model of Supabase's privilege
-- system that an external review disproved the same day. Two consequences:
--
-- 1. INV-2 ("NULL ACL means PUBLIC retains the default EXECUTE grant") is
--    STRUCTURALLY UNFIREABLE on Supabase and always reported clean.
--
--    Supabase ships `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO
--    anon, authenticated, service_role`, so every function created in `public`
--    gets an EXPLICIT acl. `proacl` is therefore never NULL. Verified on
--    production 2026-07-27: 0 of 21 SECURITY DEFINER functions had a NULL ACL,
--    and pg_default_acl reads
--      {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,
--       service_role=X/postgres}
--    A NULL ACL means "stock Postgres defaults", which is the dangerous state
--    on vanilla Postgres but is unreachable here. The invariant could never
--    fail, so it inflated the control's apparent coverage while measuring
--    nothing — the exact false-green class this whole effort exists to remove.
--
-- 2. The genuine regression vector was never modelled at all: a SIGNATURE
--    CHANGE. `CREATE OR REPLACE FUNCTION` does NOT reset an ACL — Postgres
--    docs are explicit that "the ownership and permissions of the function do
--    not change". But altering a parameter list creates a NEW overload, and
--    that new function is born with the default privileges above (anon +
--    authenticated), while the old, correctly-revoked overload survives
--    alongside it. With AI agents churning RPC signatures this is a live risk,
--    and `admin_list_users` / `admin_filter_profile_ids` carry 6-7 parameters
--    each.
--
-- INV-2 is therefore REPLACED: instead of an unfireable NULL-ACL test, it now
-- reports any SECURITY DEFINER function name carrying more than one overload.
-- Production had zero such functions when this was written, so this does not
-- red-line anything today; it fires the first time a signature change leaves a
-- stale overload behind.
--
-- The other six invariants are unchanged.
--
-- Rollback:
--   Re-apply 20260727090000_security_invariants_report.sql.

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
  -- INV-2 (v2): a signature change creates a NEW overload that inherits the
  -- anon+authenticated default grants while the old revoked one survives.
  select 'INV-2-secdef-duplicate-overload'::text, obj,
         'SECURITY DEFINER function has more than one overload — a signature '
         'change leaves the old one behind and the new one inherits the '
         'anon/authenticated default grants'::text
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

  order by 1, 2;
$$;

comment on function public.security_invariants_report() is
  'SEC-101 v2: reports live violations of the seven database security invariants. '
  'Read-only, SECURITY INVOKER, service_role only. Zero rows = healthy. '
  'INV-2 detects duplicate overloads (the signature-change vector); the v1 '
  'NULL-ACL test was unfireable on Supabase. Called by scripts/check-db-invariants.py.';

revoke all on function public.security_invariants_report() from public;
revoke all on function public.security_invariants_report() from anon;
revoke all on function public.security_invariants_report() from authenticated;
grant execute on function public.security_invariants_report() to service_role;
