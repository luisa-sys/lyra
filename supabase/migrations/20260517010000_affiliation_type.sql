-- KAN-220 Phase 2 — Schools / Organisations / Communities split
--
-- Adds `affiliation_type` to `school_affiliations` so the table can hold
-- all three kinds of community affiliations, matching the Python
-- `lyra-app` editor UX. Existing rows default to 'school' (the only
-- thing the table held before), which is backward-compatible — no
-- backfill needed.
--
-- The check constraint is a plain TEXT column with a CHECK rather than
-- a Postgres enum so future additions ("club", "team", "religious community"?)
-- only require a constraint swap rather than the heavier `alter type … add value`.
-- Keep the values short, lowercase, ASCII so they're SQL-safe and
-- pleasant to use in queries.
--
-- Rollback:
--   drop index if exists public.school_affiliations_profile_type_idx;
--   alter table public.school_affiliations drop column if exists affiliation_type;

alter table public.school_affiliations
  add column affiliation_type text not null default 'school'
    check (affiliation_type in ('school', 'organisation', 'community'));

comment on column public.school_affiliations.affiliation_type is
  'KAN-220: one of school|organisation|community. UI splits these into three multi-input groups on the profile editor (Python lyra-app parity).';

-- Composite index so the dashboard + public-profile queries that filter
-- to one type stay fast even with the column added.
create index if not exists school_affiliations_profile_type_idx
  on public.school_affiliations (profile_id, affiliation_type);
