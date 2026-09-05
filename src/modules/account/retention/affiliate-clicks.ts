/**
 * Affiliate-click raw-event retention purge (SEC-74 · finding compliance-06).
 *
 * RETENTION_SCHEDULE.md proposes that raw affiliate click events are kept for
 * ~13 months and then removed (aggregate-only thereafter). This module computes
 * the cutoff from config and calls the `affiliate_clicks_purge_expired` SQL
 * function (SECURITY DEFINER, service_role-only) to delete rows older than it.
 *
 * The retention *window* is config, not a hardcoded constant, so the policy
 * number stays Luisa's to set/confirm:
 *   - RETENTION_AFFILIATE_CLICKS_MONTHS overrides the default of 13.
 * The cutoff is always in the past (the SQL function additionally refuses a
 * null or non-past cutoff), so a mis-set window can only ever remove old data.
 */

import { type SupabaseClient } from '@supabase/supabase-js';
import { createServiceRoleClient } from '@/modules/platform/supabase-service';
import { env } from '@/modules/platform/env';

/** Proposed default window from RETENTION_SCHEDULE.md (raw events ~13 months). */
export const DEFAULT_AFFILIATE_CLICKS_RETENTION_MONTHS = 13;

export interface AffiliateClicksRetentionSummary {
  data_type: 'affiliate_clicks';
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
export function affiliateClicksRetentionMonths(): number {
  const raw = process.env.RETENTION_AFFILIATE_CLICKS_MONTHS;
  if (raw == null || raw.trim() === '') return DEFAULT_AFFILIATE_CLICKS_RETENTION_MONTHS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_AFFILIATE_CLICKS_RETENTION_MONTHS;
  return Math.floor(n);
}

/** Compute the cutoff instant `months` before `nowMs`. Exported for testing. */
export function affiliateClicksCutoff(months: number, nowMs: number): Date {
  const d = new Date(nowMs);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

/**
 * Purge raw affiliate click events older than the configured retention window.
 * Returns a structured summary (never throws for "nothing to purge" — a 0-row
 * purge is a valid healthy result).
 */
export async function runAffiliateClicksRetention(): Promise<AffiliateClicksRetentionSummary> {
  const months = affiliateClicksRetentionMonths();
  const cutoff = affiliateClicksCutoff(months, Date.now());

  const sb = admin();
  const { data, error } = await sb.rpc('affiliate_clicks_purge_expired', {
    cutoff: cutoff.toISOString(),
  });
  if (error) {
    throw new Error(`affiliate_clicks retention purge failed: ${error.message}`);
  }

  return {
    data_type: 'affiliate_clicks',
    window_months: months,
    cutoff: cutoff.toISOString(),
    purged: typeof data === 'number' ? data : 0,
  };
}
