-- BUGS-44 / SEC-07: lock down public SECURITY DEFINER functions.
--
-- Several SECURITY DEFINER functions in the public schema were EXECUTE-able by
-- anon / authenticated:
--   * the no-arg functions (rls_auto_enable, refresh_relationship_signals,
--     oauth_connect_state_purge_expired, handle_new_user,
--     prevent_beta_self_elevation) had their EXECUTE grant reset to PUBLIC by a
--     later CREATE OR REPLACE (e.g. oauth_connect_state_purge_expired was
--     revoked at creation in 20260516250000, then reset).
--   * get_metrics_for_window had explicit anon/authenticated grants.
--
-- Fix: REVOKE EXECUTE from PUBLIC + anon + authenticated, then re-GRANT to
-- service_role only (used by the post-event sweep + maintenance/metrics crons).
-- Trigger functions still fire regardless of caller EXECUTE — verified on dev
-- that handle_new_user still creates the profile row on signup after the revoke.
--
-- Applied to dev + staging + prod (DB history) 2026-06-21.

revoke execute on function public.get_metrics_for_window(timestamptz, timestamptz) from public, anon, authenticated;
grant  execute on function public.get_metrics_for_window(timestamptz, timestamptz) to service_role;

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
grant  execute on function public.rls_auto_enable() to service_role;

revoke execute on function public.refresh_relationship_signals() from public, anon, authenticated;
grant  execute on function public.refresh_relationship_signals() to service_role;

revoke execute on function public.oauth_connect_state_purge_expired() from public, anon, authenticated;
grant  execute on function public.oauth_connect_state_purge_expired() to service_role;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant  execute on function public.handle_new_user() to service_role;

revoke execute on function public.prevent_beta_self_elevation() from public, anon, authenticated;
grant  execute on function public.prevent_beta_self_elevation() to service_role;
