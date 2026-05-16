#!/usr/bin/env tsx
/**
 * KAN-195: nightly reconciliation cron for the affiliate-clicks log.
 *
 * Runs in two modes:
 *
 *   1. Pre-Sovrn (current state, no SOVRN_API_KEY): no-op with a clear log
 *      message. Today the affiliate_clicks table fills up with rows where
 *      provider='raw' or 'sovrn' (stubbed) and converted_at=NULL; there's
 *      nothing to reconcile against because there's no upstream report.
 *
 *   2. Post-Sovrn (SOVRN_API_KEY set, KAN-184 done): fetch Sovrn's
 *      Reporting API for the past 7 days (overlap window catches late-
 *      reported conversions), parse the report, join on provider_subid,
 *      and patch the affiliate_clicks rows with converted_at +
 *      commission fields.
 *
 * Schedule (when activated): nightly via the existing scheduled-tasks
 * infra. The dashboard at /admin/affiliate-reporting reads from the
 * patched rows.
 *
 * Idempotent: re-running the script for the same period updates the same
 * rows; commission_gbp is recomputed from commission_amount + the day's
 * FX rate.
 */

import {
  buildReconciliationUpdates,
  type SovrnReportRow,
} from '../src/lib/affiliate/reporting';
import { convertToGbp, prefetchRatesToGbp } from '../src/lib/affiliate/fx';

const SOVRN_REPORT_API = 'https://api.sovrn.com/reports/transactions';

async function main(): Promise<void> {
  const apiKey = process.env.SOVRN_API_KEY;
  if (!apiKey) {
    console.log(
      '[reconcile-affiliate-clicks] SOVRN_API_KEY not set — skipping.\n' +
        '  When Sovrn approves the account (KAN-184) and SOVRN_API_KEY is\n' +
        '  provisioned, this script reconciles the past 7 days of\n' +
        '  affiliate_clicks against Sovrn\'s Reporting API.',
    );
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  // Prefetch FX rates once for this batch.
  await prefetchRatesToGbp();

  // Fetch Sovrn's transactions report for the past 7 days. Overlap window
  // catches late-reported conversions; UPSERT logic in updates means
  // re-applying the same row is a no-op.
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const url = new URL(SOVRN_REPORT_API);
  url.searchParams.set('start_date', since);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`Sovrn Reporting API HTTP ${res.status}`);
  }
  const body = (await res.json()) as { transactions: SovrnReportRow[] };
  const sovrnRows = Array.isArray(body.transactions) ? body.transactions : [];

  if (sovrnRows.length === 0) {
    console.log('[reconcile-affiliate-clicks] No conversions in the report window.');
    return;
  }

  // buildReconciliationUpdates expects fxToGbp(currency, amount) — the
  // report-row order — but convertToGbp is (amount, currency). Flip the
  // adapter here rather than mutating the public fx API.
  const updates = buildReconciliationUpdates(sovrnRows, (currency, amount) =>
    convertToGbp(amount, currency),
  );

  if (updates.length === 0) {
    console.log(
      `[reconcile-affiliate-clicks] Sovrn report had ${sovrnRows.length} rows but none had a SubID we recognise — nothing to update.`,
    );
    return;
  }

  // Lazy-import Supabase client so the no-op path stays cheap.
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Apply updates one click_id at a time. With realistic volumes (<10k
  // conversions/night) this is fine; if we ever need batching we can
  // switch to a single UPDATE ... FROM (VALUES ...) call.
  let applied = 0;
  for (const u of updates) {
    const { error } = await supabase
      .from('affiliate_clicks')
      .update({
        converted_at: u.converted_at,
        commission_amount: u.commission_amount,
        commission_currency: u.commission_currency,
        commission_gbp: u.commission_gbp,
      })
      .eq('click_id', u.click_id);
    if (error) {
      console.error(`[reconcile-affiliate-clicks] Failed to update ${u.click_id}: ${error.message}`);
      continue;
    }
    applied++;
  }

  console.log(
    `[reconcile-affiliate-clicks] Reconciliation complete: ${applied}/${updates.length} clicks updated.`,
  );
}

main().catch((err: unknown) => {
  console.error('[reconcile-affiliate-clicks] fatal:', err);
  process.exit(1);
});
