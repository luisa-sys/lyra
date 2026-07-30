-- =====================================================================
-- BUGS-77 (part 2) — capture the `ensure_rls` event trigger into the lineage.
--
-- WHAT WAS MISSING
-- ----------------
-- BUGS-77 was raised about the *function* `public.rls_auto_enable()` being
-- revoked by a migration that never created it. Investigating it turned up a
-- second, quieter gap: the event trigger that actually CALLS that function is
-- also absent from `supabase/migrations/`.
--
-- Verified 2026-07-30 on production:
--     select evtname, evtevent, evttags, pg_get_userbyid(evtowner)
--     from pg_event_trigger where evtname = 'ensure_rls';
--     -> ensure_rls | ddl_command_end | {CREATE TABLE,CREATE TABLE AS,SELECT INTO} | postgres
-- Present on dev, staging and prod. Named in NO migration file.
--
-- So before this file, a database rebuilt from the lineage would have had the
-- function but nothing to invoke it — silently losing the safety net that
-- auto-enables RLS on any new `public` table. A restore that looks complete and
-- quietly drops a security control is worse than one that fails loudly.
--
-- WHY THIS IS A FORWARD MIGRATION AND NOT TIMESTAMPED WITH THE FUNCTION
-- --------------------------------------------------------------------
-- The function is created early (`20260621090300`) because the revoke at
-- `20260621120000` needs it to exist. The TRIGGER must be created last.
--
-- If the trigger existed from `20260621090300` onward, then during a fresh
-- replay it would fire on every later table-creating migration and enable RLS on
-- tables that did not have it enabled at that point in the live databases'
-- history. The replayed schema would diverge from the live one — precisely the
-- divergence this repair exists to eliminate. Creating it at the end reproduces
-- the real sequence: the trigger was added to the live databases after those
-- tables already existed.
--
-- IDEMPOTENT AND A NO-OP EVERYWHERE IT MATTERS
-- --------------------------------------------
-- `pg_event_trigger` has no `CREATE OR REPLACE`, so this is guarded on the
-- catalogue. On dev/staging/prod the trigger already exists and this does
-- nothing but record itself in history, closing the parity gap. On a fresh
-- database it creates it.
--
-- ROLLBACK: drop event trigger if exists ensure_rls;
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    create event trigger ensure_rls
      on ddl_command_end
      when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      execute function public.rls_auto_enable();
    raise log 'bugs77: created event trigger ensure_rls';
  else
    raise log 'bugs77: event trigger ensure_rls already present — no change';
  end if;
end $$;
