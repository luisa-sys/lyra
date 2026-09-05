/**
 * KAN-195: pure aggregation helpers + reconciliation logic for the
 * affiliate reporting dashboard.
 *
 * Reads from:
 *   - affiliate_clicks (KAN-189 schema) — every click logged by the
 *     Affiliate Link Service (KAN-188 / KAN-191)
 *
 * Writes to (during reconciliation):
 *   - affiliate_clicks.converted_at / commission_amount / commission_currency
 *     / commission_gbp — when Sovrn's report confirms a sale
 *
 * Strategy: all aggregation logic is in pure functions that take rows
 * in and produce rollups out. The Supabase round-trip lives in a thin
 * wrapper. This makes the maths easy to unit-test without a DB.
 *
 * Reconciliation join key: affiliate_clicks.provider_subid is the
 * `lyra-{click_id}` or `lyra-mcp-{click_id}` string we sent to the
 * provider; Sovrn echoes it back in their CSV/JSON report.
 */

import type { AffiliateClickRow } from './types';

// ── Rollup types ────────────────────────────────────────────────────────

export type DailyMerchantRollup = {
  date: string; // YYYY-MM-DD
  merchantId: string | null; // null for unknown / raw URLs
  buyerCountry: string | null;
  clicks: number;
  conversions: number;
  conversionRate: number; // 0-1
  commissionGbp: number; // sum of commission_gbp (null treated as 0)
  epc: number; // commissionGbp / clicks (0 if clicks=0)
};

export type ProviderSplit = {
  provider: AffiliateClickRow['provider'];
  clicks: number;
  conversions: number;
};

export type SourceSplit = {
  source: AffiliateClickRow['source'];
  clicks: number;
  conversions: number;
};

// ── Pure aggregation functions ──────────────────────────────────────────

/** Bucket rows by (day × merchant × buyer_country) and compute clicks /
 *  conversions / commission / EPC. */
export function rollupByDailyMerchant(rows: AffiliateClickRow[]): DailyMerchantRollup[] {
  const map = new Map<string, DailyMerchantRollup>();
  for (const r of rows) {
    const day = (r.created_at ?? '').slice(0, 10);
    if (!day) continue;
    const key = `${day}\x00${r.merchant_id ?? ''}\x00${r.buyer_country ?? ''}`;
    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        date: day,
        merchantId: r.merchant_id ?? null,
        buyerCountry: r.buyer_country ?? null,
        clicks: 0,
        conversions: 0,
        conversionRate: 0,
        commissionGbp: 0,
        epc: 0,
      };
      map.set(key, bucket);
    }
    bucket.clicks += 1;
    if (r.converted_at) bucket.conversions += 1;
    const gbp = parseCommissionGbp(r.commission_gbp);
    bucket.commissionGbp += gbp;
  }
  for (const b of map.values()) {
    b.conversionRate = b.clicks > 0 ? b.conversions / b.clicks : 0;
    b.epc = b.clicks > 0 ? b.commissionGbp / b.clicks : 0;
  }
  return [...map.values()].sort((a, b) =>
    a.date === b.date
      ? (a.merchantId ?? '').localeCompare(b.merchantId ?? '')
      : a.date < b.date ? 1 : -1, // newest first
  );
}

/** Split clicks by which provider monetised them (or 'raw' if none). */
export function splitByProvider(rows: AffiliateClickRow[]): ProviderSplit[] {
  const map = new Map<AffiliateClickRow['provider'], ProviderSplit>();
  for (const r of rows) {
    let bucket = map.get(r.provider);
    if (!bucket) {
      bucket = { provider: r.provider, clicks: 0, conversions: 0 };
      map.set(r.provider, bucket);
    }
    bucket.clicks += 1;
    if (r.converted_at) bucket.conversions += 1;
  }
  return [...map.values()].sort((a, b) => b.clicks - a.clicks);
}

/** Split clicks by surface (web / mcp / email) — the MCP split is the
 *  whole point of the `lyra-mcp-` SubID convention from KAN-189 / KAN-201. */
export function splitBySource(rows: AffiliateClickRow[]): SourceSplit[] {
  const map = new Map<AffiliateClickRow['source'], SourceSplit>();
  for (const r of rows) {
    let bucket = map.get(r.source);
    if (!bucket) {
      bucket = { source: r.source, clicks: 0, conversions: 0 };
      map.set(r.source, bucket);
    }
    bucket.clicks += 1;
    if (r.converted_at) bucket.conversions += 1;
  }
  return [...map.values()].sort((a, b) => b.clicks - a.clicks);
}

// ── Reconciliation ──────────────────────────────────────────────────────

export type SovrnReportRow = {
  /** SubID echoed back. Format: `lyra-{uuid}` or `lyra-mcp-{uuid}`. */
  sub_id: string;
  /** ISO timestamp when the sale was confirmed by the merchant. */
  converted_at: string;
  /** Commission amount in the merchant's currency. */
  commission_amount: number;
  /** ISO-4217 currency code. */
  commission_currency: string;
};

export type ReconciliationUpdate = {
  click_id: string;
  converted_at: string;
  commission_amount: string; // numeric stored as string
  commission_currency: string;
  commission_gbp: string;
};

/** Convert a Sovrn report into the click-row updates we'll apply.
 *
 * fxToGbp(currency, amount) → GBP amount. Inject the FX function so
 * unit tests can use a deterministic fake; production injects the daily
 * cached FX call (separate module).
 */
export function buildReconciliationUpdates(
  sovrnRows: SovrnReportRow[],
  fxToGbp: (currency: string, amount: number) => number,
): ReconciliationUpdate[] {
  const updates: ReconciliationUpdate[] = [];
  for (const row of sovrnRows) {
    const clickId = parseClickIdFromSubId(row.sub_id);
    if (!clickId) continue; // not one of ours
    const gbp = fxToGbp(row.commission_currency, row.commission_amount);
    updates.push({
      click_id: clickId,
      converted_at: row.converted_at,
      commission_amount: row.commission_amount.toFixed(4),
      commission_currency: row.commission_currency,
      commission_gbp: gbp.toFixed(4),
    });
  }
  return updates;
}

/** Recover the opaque click_id from our SubID. Returns null if the SubID
 *  isn't one of ours (Sovrn's report may contain other publishers' SubIDs
 *  in shared accounts). */
export function parseClickIdFromSubId(subId: string | null | undefined): string | null {
  if (!subId || typeof subId !== 'string') return null;
  const mcp = subId.match(/^lyra-mcp-([0-9a-f-]{36})$/);
  if (mcp) return mcp[1];
  const web = subId.match(/^lyra-([0-9a-f-]{36})$/);
  if (web) return web[1];
  return null;
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** commission_gbp comes off the wire as a numeric string ("12.4500") or
 *  null. Coerce to a finite number, treating null/invalid as 0. */
function parseCommissionGbp(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}
