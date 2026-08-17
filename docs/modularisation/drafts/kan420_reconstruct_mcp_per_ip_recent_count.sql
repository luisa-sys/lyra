-- KAN-420 DRAFT — do NOT apply. Reconstruction of the out-of-band view noted in
-- supabase/migrations/20260621090200_security_audit_fn_searchpath_and_view_invoker.sql:8.
-- Captured 2026-07-27 from dev; fingerprint-identical on staging and prod
-- (viewdef md5 5af567fd… in all three).
-- security_invoker=on is load-bearing (SEC audit 2026-06-21): the view must not
-- act as a definer-rights bypass of mcp_tool_call_log's deny-all RLS.
-- Rollback: drop view public.mcp_per_ip_recent_count;

create or replace view public.mcp_per_ip_recent_count
  with (security_invoker = on) as
select ip,
       count(*) as request_count,
       min(ts) as first_seen,
       max(ts) as last_seen
from public.mcp_tool_call_log
where ts > (now() - interval '1 hour')
group by ip
order by count(*) desc;

-- Live ACL (all three envs): postgres + service_role only — no anon/authenticated.
revoke all on public.mcp_per_ip_recent_count from public, anon, authenticated;
grant all on public.mcp_per_ip_recent_count to service_role;
