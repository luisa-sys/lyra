-- KAN-205 — Convene Phase 1: relationship_signals materialised view.
--
-- Derived signals that feed the scoreAttendee recommender (P3 / KAN-207).
-- Per-(host, contact) aggregates over the gatherings + invitee state.
-- Materialised because reads are hot (every attendee proposal) and writes are
-- cold (refreshed nightly + on key events).

create materialized view public.relationship_signals as
select
  g.host_user_id as user_id,
  i.contact_id,
  count(*) as total_invites,
  count(*) filter (where i.status = 'accepted')           as total_accepted,
  count(*) filter (where i.status = 'attended')           as total_attended,
  count(*) filter (where i.status = 'declined')           as total_declined,
  count(*) filter (where i.status = 'presumed_declined')  as total_silent,
  count(*) filter (where i.status = 'no_show')            as total_no_shows,
  max(g.finalised_slot_start)
    filter (where i.status = 'attended')                  as last_attended_at,
  max(i.invited_at)                                       as last_invited_at,
  count(distinct g.gathering_type)                        as gathering_type_diversity,
  array_agg(distinct g.gathering_type)
    filter (where g.gathering_type is not null)           as gathering_types_seen
from public.gatherings g
join public.gathering_invitees i on i.gathering_id = g.id
where g.deleted_at is null
group by g.host_user_id, i.contact_id;

create unique index relationship_signals_pk
  on public.relationship_signals (user_id, contact_id);

create index relationship_signals_recency_idx
  on public.relationship_signals (user_id, last_attended_at desc nulls last);

-- Refresh function — callable from edge functions or pg_cron.
create or replace function public.refresh_relationship_signals()
  returns void
  language sql
  security definer
  set search_path = public
as $$
  refresh materialized view concurrently public.relationship_signals;
$$;

revoke execute on function public.refresh_relationship_signals() from anon, authenticated;

comment on materialized view public.relationship_signals is 'KAN-205 — per-(host, contact) aggregates. Refreshed by refresh_relationship_signals() on a cron schedule (P8 will wire it).';
comment on function public.refresh_relationship_signals() is 'Refresh entry point for the relationship_signals materialised view. Service-role only.';

-- RLS on materialised views: Postgres doesn't enforce policies directly, but we
-- can wrap the view in a security definer function for owner-scoped reads.
-- For now, the view is service-role-readable only; the MCP read tools chain
-- explicit `.eq('user_id', authUserId)` filters (verified by the ownership
-- static-grep guard test landing in this phase).
revoke select on public.relationship_signals from anon, authenticated;
