-- =====================================================================
-- Security audit 2026-06-21 (BUGS-45 / F-04): search_by_contact_hash must not be anon-callable.
-- The app calls it as the authenticated user (src/app/dashboard/settings/discoverability-actions.ts:195,
-- rate-limited per authenticated user). Guarded so it is a no-op where the function is absent
-- (e.g. production, pre-Convene). Applied to dev + staging on 2026-06-21 (no-op on prod).
-- NB: HMAC-keying of the phone/postcode search hashes is a separate app-side change (follow-up ticket)
-- to defeat offline pre-computation; this migration only removes the unauthenticated execute path.
-- ROLLBACK: grant execute on function public.search_by_contact_hash(text, text) to anon.
-- =====================================================================
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and p.proname='search_by_contact_hash') then
    execute 'revoke execute on function public.search_by_contact_hash(text, text) from anon, public';
    execute 'grant execute on function public.search_by_contact_hash(text, text) to authenticated, service_role';
  end if;
end $$;
