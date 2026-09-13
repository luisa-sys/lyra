-- SEC-160 — reconciliation migration: mcp_tool_call_log
--
-- WHAT THIS IS, AND WHY IT LOOKS UNUSUAL
-- -------------------------------------
-- This migration creates schema that ALREADY EXISTS on dev, staging and
-- production. It is not a change; it is the missing repo record of a change
-- someone applied out of band under the ledger name `kan_232_mcp_tool_call_log`
-- (and `kan_245_mcp_tool_call_log_retention`), which has no SQL in this repo.
--
-- Confirmed 2026-08-17: `grep -rl "create table.*mcp_tool_call_log"
-- supabase/migrations/` returns ZERO, while the table is live on all three
-- databases and holds 31,965 rows on production.
--
-- So `supabase/migrations/` could not rebuild any of the three databases, and
-- CTL-049 reported "Ledger parity holds ✓" daily throughout — green because the
-- entry was BASELINED, not because it was absent. That is the finding; this
-- file is half its remedy.
--
-- WHY EVERY STATEMENT IS GUARDED
-- ------------------------------
-- Applying this to a database that already has the table must be a NO-OP, not
-- an error. Applying it to an empty one must produce the table. Both paths are
-- required: the first is every existing environment, the second is the disaster
-- recovery premise CTL-049 exists to protect.
--
-- ⚠️ FIDELITY, NOT IMPROVEMENT. This reproduces production EXACTLY as measured,
-- including things that are arguably wrong. In particular it does NOT revoke
-- the anon/authenticated grants Supabase's ALTER DEFAULT PRIVILEGES applied —
-- see the note at the foot of this file. Mixing "record what exists" with
-- "change what exists" in one migration would make it impossible to tell, later,
-- which half was the reconciliation and which was the fix.
--
-- Rollback: `drop table if exists public.mcp_tool_call_log;` — but note that on
-- any existing environment this migration changed nothing, so there is nothing
-- to roll back. On a rebuilt database, dropping it removes the MCP server's
-- audit trail and the server will error on its next authenticated tool call.

create table if not exists public.mcp_tool_call_log (
  id             uuid        not null default gen_random_uuid(),
  ip             text        not null,
  tool           text        not null,
  method         text        not null,
  ts             timestamptz not null default now(),
  api_key_prefix text,
  status_code    smallint,
  constraint mcp_tool_call_log_pkey primary key (id)
);

comment on table public.mcp_tool_call_log is
  'KAN-232: per-request audit log for the MCP server. Service-role write only; never expose to anon. 30-day retention via pg_cron (KAN-245).';

create index if not exists idx_mcp_tool_call_log_tool_ts
  on public.mcp_tool_call_log using btree (tool, ts desc);

create index if not exists idx_mcp_tool_call_log_ip_ts
  on public.mcp_tool_call_log using btree (ip, ts desc);

-- RLS with ZERO policies is deliberate and is the whole protection here: with
-- row level security enabled and no policy granting anything, anon and
-- authenticated are denied every row regardless of their table grants. Only
-- service_role — which bypasses RLS — can read or write. Do not "fix" the
-- absence of policies by adding one.
alter table public.mcp_tool_call_log enable row level security;

-- ---------------------------------------------------------------------------
-- ⚠️ KNOWN GAP, DELIBERATELY NOT CLOSED HERE (raised separately)
--
-- Measured on production 2026-08-17, `anon` and `authenticated` each hold
-- SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER on this
-- table — Supabase's ALTER DEFAULT PRIVILEGES grants ALL on every new table in
-- `public`, and nothing revoked them (gotcha #26).
--
-- That directly contradicts this table's own comment, "never expose to anon".
-- It is not currently exploitable, because RLS-with-no-policies denies those
-- roles anyway — but it means the protection rests on ONE mechanism. If RLS
-- were ever disabled on this table, anon would immediately be able to read
-- 31,965 rows of IP addresses and tool-call history, and to TRUNCATE the audit
-- trail.
--
-- The revoke is NOT applied here on purpose: it is a behaviour change on a live
-- production table and belongs on the dev -> staging -> prod path with the
-- writers verified first, not smuggled into a migration whose stated job is to
-- record what already exists.
-- ---------------------------------------------------------------------------
