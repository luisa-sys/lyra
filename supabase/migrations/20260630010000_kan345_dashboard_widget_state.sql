-- KAN-345 (epic KAN-349) — per-user dashboard widget dismissal state.
--
-- A JSONB map { widget_id: { dismissed_at, state } } on profiles. This is the
-- only genuinely new stored state the dashboard widget journey needs; everything
-- else is derived (is_published / completion_score / has-gifts / has-affiliations
-- / entitlements). A dismissal is recorded with the onboarding STATE it happened
-- in, so a widget re-surfaces when the state changes.
--
-- Security: the user writes only their OWN dismissals. profiles already has an
-- owner-update RLS policy (KAN-273/309), and dashboard_widget_state is NOT one of
-- the admin-only columns guarded by prevent_beta_self_elevation (access_tier,
-- user_status, age_status, beta_*), so an owner UPDATE that touches only this
-- column passes both the RLS and the self-elevation trigger. No new policy needed.
-- Stores no PII — widget ids + timestamps + state label only.
--
-- Rollback: alter table public.profiles drop column if exists dashboard_widget_state;

alter table public.profiles
  add column if not exists dashboard_widget_state jsonb not null default '{}'::jsonb;

comment on column public.profiles.dashboard_widget_state is
  'KAN-345: per-user dashboard widget dismissals { widget_id: { dismissed_at, state } }. User-writable on own row (RLS owner-update).';
