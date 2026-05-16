/**
 * KAN-187: read-side helpers for the `affiliate_merchant_eligibility` table.
 *
 * Consumed by:
 *   - KAN-190 (recommender eligibility filter) — drops merchants that don't
 *     pay us in the buyer's country.
 *   - KAN-188 / KAN-191 (Affiliate Link Service) — pre-flight check before
 *     calling Sovrn's Link Optimizer, so we don't waste an API call on a
 *     merchant we can't monetise.
 *   - KAN-194 (smoke monitor) — iterates the matrix for cross-country
 *     verification.
 *
 * No `'use server'` — the consumer decides which Supabase client to use
 * (service role for the link service, anon for read-only public pages).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type AffiliateNetwork =
  | 'sovrn'
  | 'amazon_direct'
  | 'geniuslink'
  | 'awin'
  | 'ebay_partner'
  | 'curated';

export type MerchantEligibilityRow = {
  merchant_id: string;
  country_code: string;
  merchant_display_name: string;
  affiliate_network: AffiliateNetwork;
  affiliate_program_id: string | null;
  commission_rate_pct: number | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Is the given (merchant, country) pair eligible to receive a commission?
 * Returns false if no row exists OR the row is inactive.
 *
 * The recommender's eligibility filter (KAN-190) calls this once per
 * candidate. For a profile-render rendering ~5 candidates this is 5 DB hits;
 * we keep them inline rather than caching because the filter is called
 * from server components which already have request-level isolation.
 */
export async function isMerchantEligibleInCountry(
  supabase: SupabaseClient,
  merchantId: string,
  countryCode: string,
): Promise<boolean> {
  if (!merchantId || !countryCode) return false;
  const country = countryCode.toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return false;

  const { data, error } = await supabase
    .from('affiliate_merchant_eligibility')
    .select('is_active')
    .eq('merchant_id', merchantId)
    .eq('country_code', country)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data) return false;
  return data.is_active === true;
}

/**
 * Batch helper — for a list of candidate merchants in one country, return
 * the set of merchant_ids that ARE eligible. Single round-trip; more
 * efficient than calling `isMerchantEligibleInCountry` per item.
 */
export async function eligibleMerchantsForCountry(
  supabase: SupabaseClient,
  merchantIds: readonly string[],
  countryCode: string,
): Promise<Set<string>> {
  if (merchantIds.length === 0) return new Set();
  const country = countryCode.toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return new Set();

  const { data, error } = await supabase
    .from('affiliate_merchant_eligibility')
    .select('merchant_id')
    .in('merchant_id', [...merchantIds])
    .eq('country_code', country)
    .eq('is_active', true);

  if (error || !data) return new Set();
  return new Set(data.map((row: { merchant_id: string }) => row.merchant_id));
}

/**
 * Type guard for an `affiliate_network` value coming off the wire (Supabase
 * returns `unknown` shape from `.select('*')`). Keep aligned with the SQL
 * CHECK constraint.
 */
const NETWORK_SET: ReadonlySet<string> = new Set<AffiliateNetwork>([
  'sovrn',
  'amazon_direct',
  'geniuslink',
  'awin',
  'ebay_partner',
  'curated',
]);

export function isAffiliateNetwork(value: unknown): value is AffiliateNetwork {
  return typeof value === 'string' && NETWORK_SET.has(value);
}
