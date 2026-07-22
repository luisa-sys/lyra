/**
 * Past-gathering retention purge (SEC-74 · finding compliance-06).
 *
 * RETENTION_SCHEDULE.md proposes that gatherings (and their invitees / RSVPs)
 * are purged ~12 months after the event. This module computes the cutoff from
 * config and calls the `gatherings_purge_expired` SQL function (SECURITY
 * DEFINER, service_role-only) to delete gatherings whose effective event
 * timestamp is older than it. Child rows cascade at the DB layer.
 *
 * The retention *window* is config, not a hardcoded constant, so the policy
 * number stays Luisa's to set/confirm:
 *   - RETENTION_GATHERINGS_MONTHS overrides the default of 12.
 * The cutoff is always in the past (the SQL function additionally refuses a
 * null or non-past cutoff), so a mis-set window can only ever remove old data
 * and never a still-upcoming gathering.
 */

import { type SupabaseClient } from '@supabase/supabase-js';
import { createServiceRoleClient } from '@/lib/supabase-service';
import { env } from '@/lib/env';

/** Proposed default window from RETENTION_SCHEDULE.md (purge ~12 months after the event). */
export const DEFAULT_GATHERINGS_RETENTION_MONTHS = 12;

export interface GatheringsRetentionSummary {
  data_type: 'gatherings';
  window_months: number;
  cutoff: string;
  purged: number;
}

function admin(): SupabaseClient {
  return createServiceRoleClient();
}

/** Read + validate the configured retention window (months). Falls back to the
 * proposed default on an unset/blank/invalid value rather than guessing an
 * unsafe (too-short) window. */
export function gatheringsRetentionMonths(): number {
  const raw = process.env.RETENTION_GATHERINGS_MONTHS;
  if (raw == null || raw.trim() === '') return DEFAULT_GATHERINGS_RETENTION_MONTHS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_GATHERINGS_RETENTION_MONTHS;
  return Math.floor(n);
}

/** Compute the cutoff instant `months` before `nowMs`. Exported for testing. */
export function gatheringsCutoff(months: number, nowMs: number): Date {
  const d = new Date(nowMs);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

/**
 * Purge past gatherings older than the configured retention window.
 * Returns a structured summary (never throws for "nothing to purge" — a 0-row
 * purge is a valid healthy result).
 */
export async function runGatheringsRetention(): Promise<GatheringsRetentionSummary> {
  const months = gatheringsRetentionMonths();
  const cutoff = gatheringsCutoff(months, Date.now());

  const sb = admin();
  const { data, error } = await sb.rpc('gatherings_purge_expired', {
    cutoff: cutoff.toISOString(),
  });
  if (error) {
    throw new Error(`gatherings retention purge failed: ${error.message}`);
  }

  return {
    data_type: 'gatherings',
    window_months: months,
    cutoff: cutoff.toISOString(),
    purged: typeof data === 'number' ? data : 0,
  };
}
