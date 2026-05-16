-- KAN-63-A: parameterised metrics-window function for anomaly detection.
--
-- Returns a JSON object with the four metrics the anomaly-detect.py
-- script compares against a 30-day baseline:
--
--   profile_signups       — new profiles created in the window
--   profile_publishes     — profiles whose `updated_at` falls in the window
--                            AND that are currently `is_published=true`. Not
--                            a perfect "publish event" signal — we don't
--                            track flip-history — but a good proxy.
--   profile_items_added   — new profile_items rows
--   reports_filed         — new user-filed reports (KAN-141)
--
-- The function is SECURITY DEFINER so the anomaly cron can call it via
-- the service-role JWT without per-table read grants. It only returns
-- counts — no PII surface. Execute-grant on `authenticated` is so the
-- /admin dashboard (KAN-141) can surface these counts to admins later
-- (KAN-63-D operator-observability work) without bypassing RLS.
--
-- Applied to all 3 envs on 2026-05-16:
--   dev    (ilprytcrnqyrsbsrfujj): ✓ via apply_migration
--   stage  (uobmlkzrjkptwhttzmmi): ✓ via apply_migration
--   prod   (llzkgprqewuwkiwclowi): ✓ via apply_migration

create or replace function public.get_metrics_for_window(
  p_start_at timestamptz,
  p_end_at timestamptz
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'profile_signups', (
      select count(*) from public.profiles
      where created_at >= p_start_at and created_at < p_end_at
    ),
    'profile_publishes', (
      select count(*) from public.profiles
      where updated_at >= p_start_at and updated_at < p_end_at
        and is_published = true
    ),
    'profile_items_added', (
      select count(*) from public.profile_items
      where created_at >= p_start_at and created_at < p_end_at
    ),
    'reports_filed', (
      select count(*) from public.reports
      where created_at >= p_start_at and created_at < p_end_at
    ),
    'window_start_at', p_start_at,
    'window_end_at', p_end_at
  );
$$;

revoke all on function public.get_metrics_for_window(timestamptz, timestamptz) from public;
grant execute on function public.get_metrics_for_window(timestamptz, timestamptz) to authenticated, service_role;
