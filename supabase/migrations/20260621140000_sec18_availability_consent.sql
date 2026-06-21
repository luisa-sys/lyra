-- SEC-18 (F-07): opt-in consent gate for sharing calendar busy-times.
--
-- Problem
-- -------
-- lyra_get_shared_availability fans out a linked Lyra profile's Google
-- free/busy to any host who has that profile as a `contacts.linked_profile_id`,
-- with the only target-side filter being `is_suspended = false`. The OAuth
-- consent the target gave was "share my calendar with Lyra for my own use", not
-- "fan it out to other users' availability queries". This is a cross-user
-- availability disclosure (IDOR-adjacent).
--
-- Fix
-- ---
-- Add a per-user opt-in flag, default FALSE (deny). The MCP availability tool
-- only includes a linked profile's busy-times when this is TRUE; otherwise the
-- attendee falls through to `requires_manual_confirm`. Paired change in
-- lyra-mcp-server/src/convene-availability-tool.ts (MCP-main lockstep, KAN-222).
--
-- Non-destructive, additive. Default false means existing users are deny until
-- they opt in via the Convene calendar-connections settings.
--
-- Apply order: dev -> staging -> prod (Supabase Migration Rules).
-- Rollback (drop column — requires sign-off per CLAUDE.md):
--   alter table public.profiles drop column if exists share_availability_with_contacts;

alter table public.profiles
  add column if not exists share_availability_with_contacts boolean not null default false;

comment on column public.profiles.share_availability_with_contacts is
  'SEC-18 — when true, this user consents to their calendar busy-times being shared with hosts who have them as a linked contact (Convene shared availability). Default false (deny).';
