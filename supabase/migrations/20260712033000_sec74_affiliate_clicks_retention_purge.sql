-- SEC-74 (finding compliance-06, UK-GDPR Art. 5(1)(e) storage limitation).
--
-- Retention purge for raw affiliate click events. RETENTION_SCHEDULE.md proposes
-- "Affiliate click events — raw events ~13 months, then aggregate-only". This
-- migration adds the deletion mechanism the schedule promises but did not have:
-- a SECURITY DEFINER purge function the retention cron calls with a caller-supplied
-- cutoff (the window itself is decided in app config, so the retention *policy*
-- number stays Luisa's to set/confirm — not hardcoded destructively here).
--
-- Safety rails baked into the function:
--   * NULL cutoff  -> raise (never a blanket delete).
--   * cutoff >= now() -> raise (refuse to purge current/future rows; a mis-set
--     window can only ever delete OLD data, never the live table).
--   * Deletes only rows strictly older than the cutoff; returns the row count so
--     the caller/cron can log exactly how many rows aged out.
--
-- Follows the established purge-fn + BUGS-44 ACL pattern
-- (oauth_connect_state_purge_expired): security definer, pinned search_path,
-- EXECUTE revoked from public/anon/authenticated, granted to service_role only.
-- The cron authenticates with the service role, which bypasses RLS to sweep
-- across all rows (the purge's whole purpose).
--
-- Rollback (one-time, do not include in migration body):
--   drop function if exists public.affiliate_clicks_purge_expired(timestamptz);

create or replace function public.affiliate_clicks_purge_expired(cutoff timestamptz)
  returns integer
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  deleted integer;
begin
  if cutoff is null then
    raise exception 'affiliate_clicks_purge_expired: cutoff must not be null';
  end if;
  -- Fail closed: never purge rows at/after "now". A retention window is only ever
  -- allowed to remove data that is already older than the current time.
  if cutoff >= now() then
    raise exception 'affiliate_clicks_purge_expired: cutoff (%) must be in the past', cutoff;
  end if;

  delete from public.affiliate_clicks where created_at < cutoff;
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke execute on function public.affiliate_clicks_purge_expired(timestamptz) from public, anon, authenticated;
grant  execute on function public.affiliate_clicks_purge_expired(timestamptz) to service_role;

comment on function public.affiliate_clicks_purge_expired(timestamptz) is
  'SEC-74 retention purge — deletes raw affiliate_clicks older than the caller-supplied cutoff (proposed window 13 months, set in app config). service_role only; refuses null/future cutoffs.';
