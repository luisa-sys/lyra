-- =====================================================================
-- Security audit 2026-06-21 (BUGS-45): F-18 pin function search_path; F-21 view security_invoker.
-- All flagged functions are SECURITY INVOKER with fully schema-qualified bodies (public.*) or
-- pure pg_catalog built-ins (now/count), so SET search_path='' is non-breaking. The view's only
-- consumer is the service-role abuse pipeline (KAN-233), unaffected by security_invoker.
-- Applied to dev + staging + prod on 2026-06-21. Idempotent.
-- ROLLBACK: alter each function reset search_path; alter view set (security_invoker = off);
--           grant select on public.mcp_per_ip_recent_count to anon, authenticated.
-- =====================================================================

-- F-18 — pin search_path on SECURITY INVOKER trigger/helper functions
alter function public.affiliate_merchant_eligibility_touch_updated_at() set search_path = '';
alter function public.consent_log_block_mutations() set search_path = '';
alter function public.convene_set_updated_at() set search_path = '';
alter function public.enforce_pcs_cap() set search_path = '';
alter function public.enforce_profile_files_cap() set search_path = '';
alter function public.gathering_events_log_block_mutations() set search_path = '';
alter function public.gathering_invitees_enforce_host_owns_contact() set search_path = '';
alter function public.recommender_catalogue_touch_updated_at() set search_path = '';
alter function public.tribe_members_enforce_same_owner() set search_path = '';
alter function public.tribe_only_visible_tribes(uuid) set search_path = '';

-- F-18 — oauth server trigger fn exists on dev/staging only (pre-prod); guarded
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and p.proname='oauth_clients_set_updated_at') then
    execute $q$alter function public.oauth_clients_set_updated_at() set search_path = ''$q$;
  end if;
end $$;

-- F-21 — abuse-detection view must run as the querying role, not its postgres owner
alter view public.mcp_per_ip_recent_count set (security_invoker = on);
revoke all on public.mcp_per_ip_recent_count from anon, authenticated;
