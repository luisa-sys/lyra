-- BUGS-62 — Convene invite dispatcher: atomic queue claim to stop duplicate sends.
--
-- Problem: the dispatcher SELECTed queued rows and only flipped them to 'sent'
-- AFTER the provider call, so two overlapping runs (cron + manual drain, or two
-- crons on a slow provider) could both read the same 'queued' row and send it
-- twice.
--
-- Fix (application side, dispatch.ts): claim rows atomically before sending —
--   UPDATE ... SET delivery_status='sending', claimed_at=now()
--   WHERE id = ANY(batch) AND delivery_status='queued' RETURNING ...
-- Only the rows RETURNed are owned by this run; a concurrent run racing on the
-- same row loses the WHERE delivery_status='queued' guard and claims nothing.
--
-- This migration adds the two schema affordances the claim needs:
--   1. a transient 'sending' value in the delivery_status CHECK constraint;
--   2. a claimed_at timestamp so a crashed run's orphaned 'sending' rows can be
--      reclaimed (reset to 'queued') by a later run after a staleness window.
--
-- Non-destructive: widens a CHECK and adds a nullable column. No data rewrite.
--
-- Rollback:
--   ALTER TABLE public.gathering_invite_messages DROP COLUMN IF EXISTS claimed_at;
--   ALTER TABLE public.gathering_invite_messages
--     DROP CONSTRAINT IF EXISTS gathering_invite_messages_delivery_status_check;
--   ALTER TABLE public.gathering_invite_messages
--     ADD CONSTRAINT gathering_invite_messages_delivery_status_check
--     CHECK (delivery_status IN (
--       'queued', 'sent', 'delivered', 'opened', 'clicked',
--       'bounced', 'complained', 'failed'));
--   -- (reset any leftover transient rows first:
--   --   UPDATE public.gathering_invite_messages SET delivery_status='queued'
--   --   WHERE delivery_status='sending';)

alter table public.gathering_invite_messages
  drop constraint if exists gathering_invite_messages_delivery_status_check;

alter table public.gathering_invite_messages
  add constraint gathering_invite_messages_delivery_status_check
  check (delivery_status in (
    'queued', 'sending', 'sent', 'delivered', 'opened', 'clicked',
    'bounced', 'complained', 'failed'
  ));

alter table public.gathering_invite_messages
  add column if not exists claimed_at timestamptz;

-- Partial index to make the stale-claim reclaim scan cheap (only 'sending' rows).
create index if not exists gathering_invite_messages_sending_claimed_idx
  on public.gathering_invite_messages (claimed_at)
  where delivery_status = 'sending';
