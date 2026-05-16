#!/usr/bin/env tsx
/**
 * KAN-187: seed / refresh script for `affiliate_merchant_eligibility`.
 *
 * Runs in two modes:
 *
 *   1. Pre-Sovrn (current state, no SOVRN_API_KEY): no-op. The starter
 *      seed in the migration 20260516250000_affiliate_merchant_eligibility.sql
 *      covers the merchant_detector allowlist × supported countries. The
 *      KAN-200 curated catalogue points at the same merchant_ids so the
 *      KAN-190 eligibility filter has something to find.
 *
 *   2. Post-Sovrn (SOVRN_API_KEY set, KAN-184 done): fetch Sovrn's Merchant
 *      API page-by-page, upsert rows into the table keyed on
 *      (merchant_id, country_code), and never DELETE — admins toggle
 *      is_active=false to retire merchants. This preserves history for
 *      reconciliation (KAN-195).
 *
 * Run manually for the first refresh after Sovrn comes online:
 *   tsx scripts/seed-affiliate-merchant-eligibility.ts
 *
 * Scheduled nightly via the existing scheduled-tasks infra (separate ticket)
 * once verified manually.
 */

const SOVRN_MERCHANT_API_BASE = 'https://api.sovrn.com/merchants';

type SovrnMerchant = {
  id: string;
  name: string;
  country_codes: string[];
  commission_rate?: number;
  active: boolean;
};

async function main(): Promise<void> {
  const apiKey = process.env.SOVRN_API_KEY;
  if (!apiKey) {
    console.log(
      '[seed-eligibility] SOVRN_API_KEY not set — skipping Sovrn fetch.\n' +
        '  The starter seed in 20260516250000_affiliate_merchant_eligibility.sql\n' +
        '  covers the merchant_detector allowlist (amazon, etsy, ebay,\n' +
        '  johnlewis, notonthehighstreet, bookshop_org, otto) × supported\n' +
        '  delivery countries. Re-run this script once SOVRN_API_KEY is\n' +
        '  provisioned (KAN-184).',
    );
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  // Lazy-import @supabase/supabase-js so the no-op path doesn't pay for
  // the import cost on every cron tick before Sovrn lands.
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, supabaseKey);

  let page = 1;
  let upserted = 0;
  for (;;) {
    const url = new URL(SOVRN_MERCHANT_API_BASE);
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', '100');

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      throw new Error(`Sovrn Merchant API HTTP ${res.status}`);
    }
    const body = (await res.json()) as { merchants: SovrnMerchant[]; has_more: boolean };
    if (!Array.isArray(body.merchants) || body.merchants.length === 0) break;

    const rows = body.merchants.flatMap((m) =>
      m.country_codes.map((cc) => ({
        merchant_id: m.id,
        country_code: cc.toUpperCase(),
        merchant_display_name: m.name,
        affiliate_network: 'sovrn' as const,
        affiliate_program_id: m.id,
        commission_rate_pct: m.commission_rate ?? null,
        is_active: m.active,
      })),
    );

    if (rows.length > 0) {
      const { error } = await supabase
        .from('affiliate_merchant_eligibility')
        .upsert(rows, { onConflict: 'merchant_id,country_code' });
      if (error) throw new Error(`Upsert failed page ${page}: ${error.message}`);
      upserted += rows.length;
    }

    if (!body.has_more) break;
    page += 1;
  }

  console.log(`[seed-eligibility] Sovrn refresh complete: ${upserted} rows upserted.`);
}

main().catch((err: unknown) => {
  console.error('[seed-eligibility] fatal:', err);
  process.exit(1);
});
