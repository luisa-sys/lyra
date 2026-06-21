-- =====================================================================
-- Security audit 2026-06-21 (BUGS-45 residual / BUGS-48): revoke the PUBLIC default
-- EXECUTE on SECURITY DEFINER trigger/maintenance functions still flagged by the advisor.
-- These were flagged because `revoke from anon, authenticated` is ineffective while PUBLIC
-- retains EXECUTE. Trigger/event-trigger fns (handle_new_user, prevent_beta_self_elevation,
-- rls_auto_enable) fire regardless of EXECUTE grant. Maintenance fns are server-side:
--   - refresh_relationship_signals: called via service-role (src/lib/convene/post-event.ts:118)
--   - oauth_connect_state_purge_expired: server/cron.
-- Applied to dev + staging + prod on 2026-06-21. Existence-guarded → no-op where absent. Idempotent.
-- ROLLBACK: grant execute on function public.<fn>(...) to anon, authenticated; (per function)
-- =====================================================================
do $$
declare
  sig text;
  sigs text[] := array[
    'public.handle_new_user()',
    'public.prevent_beta_self_elevation()',
    'public.rls_auto_enable()',
    'public.oauth_connect_state_purge_expired()',
    'public.refresh_relationship_signals()'
  ];
begin
  foreach sig in array sigs loop
    begin
      execute 'revoke execute on function ' || sig || ' from public, anon, authenticated';
      execute 'grant execute on function ' || sig || ' to service_role';
    exception when undefined_function then
      null; -- absent in this environment; skip
    end;
  end loop;
end $$;
