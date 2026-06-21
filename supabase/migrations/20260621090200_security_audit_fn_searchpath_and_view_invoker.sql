-- =====================================================================
-- Security audit 2026-06-21 (BUGS-45): F-18 pin function search_path; F-21 view security_invoker.
-- All flagged functions are SECURITY INVOKER with fully schema-qualified bodies (public.*) or
-- pure pg_catalog built-ins (now/count), so SET search_path='' is non-breaking. The view's only
-- consumer is the service-role abuse pipeline (KAN-233), unaffected by security_invoker.
-- Applied to dev + staging + prod on 2026-06-21. Existence-guarded so it applies cleanly on a
-- fresh schema rebuild (e.g. Supabase preview branches) where some objects (notably the
-- mcp_per_ip_recent_count view) are created out-of-band. Idempotent.
-- ROLLBACK: alter each function reset search_path; alter view set (security_invoker = off);
--           grant select on public.mcp_per_ip_recent_count to anon, authenticated.
-- =====================================================================

-- F-18 — pin search_path on flagged SECURITY INVOKER functions (skip any absent in this env)
do $$
declare
  sig text;
  sigs text[] := array[
    'public.affiliate_merchant_eligibility_touch_updated_at()',
    'public.consent_log_block_mutations()',
    'public.convene_set_updated_at()',
    'public.enforce_pcs_cap()',
    'public.enforce_profile_files_cap()',
    'public.gathering_events_log_block_mutations()',
    'public.gathering_invitees_enforce_host_owns_contact()',
    'public.recommender_catalogue_touch_updated_at()',
    'public.tribe_members_enforce_same_owner()',
    'public.tribe_only_visible_tribes(uuid)',
    'public.oauth_clients_set_updated_at()'
  ];
begin
  foreach sig in array sigs loop
    begin
      execute 'alter function ' || sig || ' set search_path = ' || quote_literal('');
    exception when undefined_function then
      null; -- absent in this environment; skip
    end;
  end loop;
end $$;

-- F-21 — abuse-detection view runs as the querying role, not its postgres owner (guarded)
do $$
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'mcp_per_ip_recent_count' and c.relkind = 'v'
  ) then
    execute 'alter view public.mcp_per_ip_recent_count set (security_invoker = on)';
    execute 'revoke all on public.mcp_per_ip_recent_count from anon, authenticated';
  end if;
end $$;
