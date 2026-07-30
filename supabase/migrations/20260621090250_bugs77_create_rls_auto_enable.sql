-- =====================================================================
-- BUGS-77 — LINEAGE REPAIR: create public.rls_auto_enable().
--
-- WHY THIS FILE HAS AN OLDER TIMESTAMP THAN THE DAY IT WAS WRITTEN
-- ---------------------------------------------------------------
-- This is a deliberate, founder-authorised insertion into applied migration
-- history (Option A on BUGS-77, approved 2026-07-30). CLAUDE.md forbids editing
-- history as a rule; the exception is granted here for the same reason it was
-- granted for BUGS-75's renames: the lineage cannot rebuild a database from
-- scratch, so the DR restore path is unprovable and SEC-23 / SEC-31 cannot be
-- closed honestly.
--
-- THE DEFECT
-- ----------
-- `20260621120000_revoke_secdef_exec_bugs44.sql:22` runs
--     revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
-- as a bare statement. No migration ever created that function: it exists on
-- dev, staging and production only because it was created out-of-band and never
-- captured. A fresh database therefore has nothing to revoke on, and the replay
-- dies with
--     ERROR: function public.rls_auto_enable() does not exist (SQLSTATE 42883)
--
-- (The earlier reference at `20260621090400` is safe — it wraps its revoke in a
-- `do $$ ... exception when undefined_function then null; end $$`, so it no-ops
-- on a fresh DB. Only the 120000 one is unguarded. This file is timestamped to
-- sort before both regardless, so the function exists before anything names it.)
--
-- FAITHFULNESS — this is a reproduction, not a reconstruction
-- ----------------------------------------------------------
-- The body below is the live definition, captured 2026-07-30 via
--     select pg_get_functiondef('public.rls_auto_enable()'::regprocedure);
-- and verified BYTE-IDENTICAL across all three environments:
--     md5(pg_get_functiondef(oid)) = 6998ea6b4c2480f5d2e34b5dcf3f8d36
--     on dev (ilprytcrnqyrsbsrfujj), staging (uobmlkzrjkptwhttzmmi)
--     and prod (llzkgprqewuwkiwclowi)
-- with ACL `postgres=X/postgres | service_role=X/postgres` on all three.
-- So this changes no behaviour anywhere: it records what is already deployed.
--
-- NOT APPLIED TO THE LIVE ENVIRONMENTS, BY DESIGN
-- -----------------------------------------------
-- Its version sorts below every applied migration, so it will never run against
-- dev/staging/prod — where the object already exists. It exists for the fresh
-- replay. That asymmetry is the whole point of a lineage repair.
--
-- THE EVENT TRIGGER IS A SEPARATE FILE, DELIBERATELY
-- --------------------------------------------------
-- `rls_auto_enable` is an event-trigger function, and its trigger `ensure_rls`
-- (ddl_command_end on CREATE TABLE / CREATE TABLE AS / SELECT INTO) is ALSO
-- absent from the lineage — so a fresh database would have had no RLS
-- auto-enable safety net at all. That is created by a FORWARD migration, not
-- here: creating the trigger this early would make it fire during the replay of
-- every later table-creating migration, auto-enabling RLS on tables that did
-- not have it enabled at that point on the live databases. The replayed schema
-- would then diverge from the live one — the exact thing this repair exists to
-- prevent. Function early, trigger last.
--
-- ROLLBACK: drop function if exists public.rls_auto_enable();
--           (Do not run against a live environment — the event trigger
--           `ensure_rls` depends on it.)
-- =====================================================================

create or replace function public.rls_auto_enable()
  returns event_trigger
  language plpgsql
  security definer
  set search_path to 'pg_catalog'
as $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

-- Reproduce the live ACL exactly (gotcha #26: `from public` alone leaves anon
-- and authenticated holding EXECUTE, because Supabase grants them by default —
-- all three roles must be named). Event triggers fire regardless of EXECUTE, so
-- this is defence in depth rather than the control itself.
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
grant execute on function public.rls_auto_enable() to service_role;
