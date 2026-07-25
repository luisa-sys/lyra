/**
 * KAN-63-A: typed wrappers around the `get_metrics_for_window` Postgres
 * function. The script that fires the anomaly cron lives in Python
 * (`scripts/anomaly-detect.py`) and talks to Supabase via REST directly,
 * but the same metrics surface is useful in the admin dashboard
 * (eventual KAN-63-D operator observability work).
 *
 * Each function returns the JSON shape the RPC emits — including the
 * window bounds — so callers can correlate which slice they got back
 * if they fire a batch of RPC calls in parallel.
 */

import { createClient } from '@/lib/supabase-server';
import { createServiceRoleClient } from '@/lib/supabase-service';

export interface MetricsSnapshot {
  profile_signups: number;
  profile_publishes: number;
  profile_items_added: number;
  reports_filed: number;
  window_start_at: string;
  window_end_at: string;
}

export type AnomalyWindowKey = '1h' | '24h' | '7d';

const WINDOW_MS: Record<AnomalyWindowKey, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

/**
 * Returns metrics counts for the named rolling window ending now.
 *
 * @example
 *   const last24h = await getAnomalyWindow('24h');
 *   if (last24h.profile_signups > 100) ...
 */
export async function getAnomalyWindow(window: AnomalyWindowKey): Promise<MetricsSnapshot> {
  const supabase = await createClient();
  const end = new Date();
  const start = new Date(end.getTime() - WINDOW_MS[window]);
  const { data, error } = await supabase.rpc('get_metrics_for_window', {
    p_start_at: start.toISOString(),
    p_end_at: end.toISOString(),
  });
  if (error) {
    throw new Error(`get_metrics_for_window(${window}) failed: ${error.message}`);
  }
  return data as MetricsSnapshot;
}

/**
 * Returns metrics counts for an arbitrary explicit time window. Useful
 * when the caller wants to align the window with another timeline
 * (e.g. a release boundary) rather than "ending now".
 */
export async function getMetricsForWindow(
  startAt: Date,
  endAt: Date,
): Promise<MetricsSnapshot> {
  if (endAt.getTime() <= startAt.getTime()) {
    throw new Error('endAt must be strictly after startAt');
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_metrics_for_window', {
    p_start_at: startAt.toISOString(),
    p_end_at: endAt.toISOString(),
  });
  if (error) {
    throw new Error(`get_metrics_for_window failed: ${error.message}`);
  }
  return data as MetricsSnapshot;
}

/**
 * BUGS-71: service-role variant of {@link getAnomalyWindow} for the admin
 * monitoring dashboard.
 *
 * `get_metrics_for_window` is SECURITY DEFINER and — since the BUGS-44 / SEC-07
 * (F-14) lockdown migration `20260621120000` — EXECUTE is granted to
 * `service_role` ONLY (revoked from public/anon/authenticated). The
 * `/admin/monitoring` page reads it through the request-scoped anon SSR client,
 * so every window came back as "data unavailable" (a swallowed 42501
 * permission-denied). Route the admin read through the hardened service-role
 * client instead — exactly like that page's `getCounts()` already does.
 *
 * Do NOT "fix" this by re-granting EXECUTE to `authenticated`: that would let
 * any logged-in user call a SECURITY DEFINER counts function and re-open
 * F-14 / SEC-07. Keep the grant `service_role`-only.
 *
 * Server-only + admin-gated usage (the service-role client bypasses RLS).
 * Mirrors `getAnomalyWindow`'s shape/contract so callers are interchangeable.
 */
export async function getAnomalyWindowAdmin(window: AnomalyWindowKey): Promise<MetricsSnapshot> {
  const supabase = createServiceRoleClient();
  const end = new Date();
  const start = new Date(end.getTime() - WINDOW_MS[window]);
  const { data, error } = await supabase.rpc('get_metrics_for_window', {
    p_start_at: start.toISOString(),
    p_end_at: end.toISOString(),
  });
  if (error) {
    throw new Error(`get_metrics_for_window(${window}) [admin] failed: ${error.message}`);
  }
  return data as MetricsSnapshot;
}
