-- KAN-420 DRAFT — do NOT apply. Reconstruction of the out-of-band object
-- created by applied migrations `kan_232_mcp_tool_call_log` +
-- `kan_245_mcp_tool_call_log_retention` (no git files).
-- Captured 2026-07-27 from dev; fingerprint-identical on staging and prod.
-- NOTE: kan_245's retention mechanism left no separate database object in any
-- environment (no function/trigger references this table beyond the view) — the
-- retention job runs outside the database; F7 should confirm where before
-- folding this into supabase/migrations/.
-- Rollback: drop view public.mcp_per_ip_recent_count; drop table public.mcp_tool_call_log;

create table if not exists public.mcp_tool_call_log (
  id uuid primary key default gen_random_uuid(),
  ip text not null,
  tool text not null,
  method text not null,
  ts timestamptz not null default now(),
  api_key_prefix text,
  status_code smallint
);

create index if not exists idx_mcp_tool_call_log_ip_ts
  on public.mcp_tool_call_log (ip, ts desc);
create index if not exists idx_mcp_tool_call_log_tool_ts
  on public.mcp_tool_call_log (tool, ts desc);

-- RLS enabled with ZERO policies by design: deny-all for anon/authenticated;
-- the MCP server writes via service_role (bypasses RLS). Matches live state in
-- all three envs and the rls_enabled_no_policy INFO advisor baseline.
alter table public.mcp_tool_call_log enable row level security;

grant all on table public.mcp_tool_call_log to anon, authenticated, service_role;
