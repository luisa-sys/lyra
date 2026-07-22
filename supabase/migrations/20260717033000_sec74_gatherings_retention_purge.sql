-- SEC-74 (finding compliance-06, UK-GDPR Art. 5(1)(e) storage limitation).
--
-- Retention purge for past gatherings (Convene). RETENTION_SCHEDULE.md proposes
-- "Gatherings / invitees / RSVPs — While the gathering exists; suggest purge
-- ~12 months after the event". This migration adds the deletion mechanism the
-- schedule promises but did not have: a SECURITY DEFINER purge function the
-- retention cron calls with a caller-supplied cutoff (the window itself is
-- decided in app config, so the retention *policy* number stays Luisa's to
-- set/confirm — not hardcoded destructively here).
--
-- "Past" is anchored to the most specific event/activity timestamp available so
-- an upcoming or still-being-planned gathering is never purged:
--   coalesce(finalised_slot_end, finalised_slot_start,
--            target_window_end, target_window_start, created_at) < cutoff
-- A gathering whose finalised slot (or target window) is in the future has an
-- effective timestamp after `now()`; since the cutoff is always strictly in the
-- past (enforced below), such rows can never match. Abandoned drafts that were
-- never scheduled fall back to created_at, so they too age out on the same
-- window rather than living forever.
--
-- Child rows (gathering_invitees, gathering_invite_messages, gathering_events_log,
-- RSVPs, …) are removed automatically — every child table references
-- gatherings(id) ON DELETE CASCADE — so the delete is a full purge of the
-- gathering and its associated invitee PII, which is the whole point.
--
-- Safety rails baked into the function (same as affiliate_clicks_purge_expired):
--   * NULL cutoff  -> raise (never a blanket delete).
--   * cutoff >= now() -> raise (refuse to purge current/future rows; a mis-set
--     window can only ever delete OLD data, never the live table).
--   * Returns the row count so the caller/cron can log exactly how many
--     gatherings aged out.
--
-- Follows the established purge-fn + BUGS-44 ACL pattern
-- (affiliate_clicks_purge_expired / oauth_connect_state_purge_expired): security
-- definer, pinned search_path, EXECUTE revoked from public/anon/authenticated,
-- granted to service_role only. The cron authenticates with the service role,
-- which bypasses RLS to sweep across all hosts' gatherings (the purge's purpose).
--
-- Rollback (one-time, do not include in migration body):
--   drop function if exists public.gatherings_purge_expired(timestamptz);

create or replace function public.gatherings_purge_expired(cutoff timestamptz)
  returns integer
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  deleted integer;
begin
  if cutoff is null then
    raise exception 'gatherings_purge_expired: cutoff must not be null';
  end if;
  -- Fail closed: never purge rows at/after "now". A retention window is only ever
  -- allowed to remove data that is already older than the current time.
  if cutoff >= now() then
    raise exception 'gatherings_purge_expired: cutoff (%) must be in the past', cutoff;
  end if;

  delete from public.gatherings
  where coalesce(finalised_slot_end, finalised_slot_start,
                 target_window_end, target_window_start, created_at) < cutoff;
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke execute on function public.gatherings_purge_expired(timestamptz) from public, anon, authenticated;
grant  execute on function public.gatherings_purge_expired(timestamptz) to service_role;

comment on function public.gatherings_purge_expired(timestamptz) is
  'SEC-74 retention purge — deletes gatherings whose effective event/activity timestamp is older than the caller-supplied cutoff (proposed window 12 months, set in app config). Child rows cascade. service_role only; refuses null/future cutoffs.';
