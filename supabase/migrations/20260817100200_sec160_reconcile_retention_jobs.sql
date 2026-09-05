-- SEC-160 — reconciliation migration: the two pg_cron retention jobs
--
-- Third and final file of the SEC-160 reconciliation. Recovered from
-- production's `cron.job` catalogue on 2026-08-17:
--
--   jobid 1  mcp_tool_call_log_retention           0 3 * * *
--   jobid 2  content_moderation_flags_retention   15 3 * * *
--
-- ⚠️ NOTE WHAT THIS EXPOSES ABOUT THE LEDGER. The migration ledger named
-- `kan_245_mcp_tool_call_log_retention` — one job. The SECOND job,
-- `content_moderation_flags_retention`, appears in NO ledger entry at all. So
-- the "12 applied-not-in-repo" figure CTL-049 baselines is not a complete
-- census of out-of-band objects; it is a census of out-of-band LEDGER ROWS.
-- An object created without a ledger entry is invisible to that control by
-- construction. Recorded on SEC-160.
--
-- WHY THIS MATTERS MORE THAN THE TABLES DO
-- ----------------------------------------
-- These jobs are the retention half of a data-protection posture, not
-- housekeeping. `mcp_tool_call_log` stores IP addresses; `content_moderation_flags`
-- stores a snippet of user-authored text that tripped moderation. Both are
-- personal data on a service holding minors' information. A database rebuilt
-- from this repo WITHOUT these jobs would retain both indefinitely — a
-- compliance failure that nothing in CI would report, because the tables
-- themselves would look correct.
--
-- IDEMPOTENCY: `cron.schedule(name, schedule, command)` updates the job when a
-- job of that name already exists, so re-applying is a no-op in effect.
--
-- FAILING LOUD IS DELIBERATE. If `pg_cron` is unavailable this migration fails
-- and the rebuild stops. That is the correct outcome: a silent skip would
-- produce a database that looks complete while retaining personal data forever,
-- which is precisely the false-green the Workflow & Backup Integrity Policy
-- forbids. Better a stopped rebuild someone must think about.
--
-- Rollback:
--   select cron.unschedule('mcp_tool_call_log_retention');
--   select cron.unschedule('content_moderation_flags_retention');

create extension if not exists pg_cron;

-- 30-day retention on the MCP per-request audit log (KAN-232 / KAN-245).
select cron.schedule(
  'mcp_tool_call_log_retention',
  '0 3 * * *',
  $job$delete from public.mcp_tool_call_log where ts < now() - interval '30 days'$job$
);

-- 30-day retention on moderation flags (KAN-244). Note this job exists on
-- production but is named in NO migration-ledger row — see the header.
select cron.schedule(
  'content_moderation_flags_retention',
  '15 3 * * *',
  $job$delete from public.content_moderation_flags where created_at < now() - interval '30 days'$job$
);
