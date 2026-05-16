/**
 * KAN-190: V2 eligibility filter — drops product candidates whose merchant
 * is not in `affiliate_merchant_eligibility` for the buyer's country (and
 * separately, that can't ship to the recipient's country).
 *
 * Sits between candidate-sourcing (KAN-200) and the ranker (KAN-199) in the
 * V2 pipeline. The candidate sourcer's Tier 1 already checks the
 * `recommender_catalogue.buyer_countries[]` field; this filter adds a
 * second pass against the canonical KAN-187 table so:
 *
 *   - Sovrn-sourced (Tier 2) and LLM-generated (Tier 3) candidates are
 *     also filtered, not just Tier 1.
 *   - Admins can toggle a merchant inactive globally (is_active=false in
 *     KAN-187) without having to update every catalogue entry.
 *
 * Drop-ratio is logged at server-side INFO. If the filter would drop the
 * candidate count below `minResults`, we return the un-filtered set with
 * a warning rather than starve the recommendation — better to show
 * possibly-ineligible products than nothing. Sovrn will reject the
 * actual link generation downstream in those rare cases.
 *
 * Shipping-to-recipient (KAN-185 recipient_country) is a thinner shipping
 * rule that's NOT yet in the eligibility table — for MVP we treat it as
 * a per-merchant code helper (`canShipTo`) because each merchant's
 * shipping rules are different and not all in Sovrn's data. Once we have
 * structured shipping data, this collapses into the eligibility lookup.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { eligibleMerchantsForCountry } from '@/lib/affiliate/eligibility';
import type { ProductCandidate } from './types';

export type EligibilityFilterInput = {
  candidates: ProductCandidate[];
  buyerCountry: string;
  recipientCountry: string;
  /**
   * If after filtering we have fewer than this many candidates, return the
   * pre-filter list (with a warning) rather than starve the recommender.
   * Default 3 — matches the KAN-190 ticket spec.
   */
  minResults?: number;
};

export type EligibilityFilterResult = {
  candidates: ProductCandidate[];
  /** How many candidates were dropped by the buyer-country eligibility check. */
  droppedByEligibility: number;
  /** How many candidates were dropped by the recipient-shipping check. */
  droppedByShipping: number;
  /** Set to true if the filter would have dropped below minResults and
   *  was bypassed. */
  fellBackToUnfiltered: boolean;
};

/**
 * The main filter. Async because it consults Supabase.
 */
export async function filterCandidatesByEligibility(
  supabase: SupabaseClient,
  input: EligibilityFilterInput,
): Promise<EligibilityFilterResult> {
  const minResults = input.minResults ?? 3;
  if (input.candidates.length === 0) {
    return {
      candidates: [],
      droppedByEligibility: 0,
      droppedByShipping: 0,
      fellBackToUnfiltered: false,
    };
  }

  // Single round-trip to fetch the eligible merchant set.
  const merchantIds = Array.from(
    new Set(input.candidates.map((c) => c.merchantId)),
  );
  const eligibleMerchants = await eligibleMerchantsForCountry(
    supabase,
    merchantIds,
    input.buyerCountry,
  );

  // First pass: buyer-country eligibility.
  let droppedByEligibility = 0;
  const buyerEligible = input.candidates.filter((c) => {
    const ok = eligibleMerchants.has(c.merchantId);
    if (!ok) droppedByEligibility++;
    return ok;
  });

  // Second pass: recipient shipping. Per-merchant helper for MVP.
  let droppedByShipping = 0;
  const finalSet = buyerEligible.filter((c) => {
    const ok = canShipTo(c.merchantId, input.recipientCountry);
    if (!ok) droppedByShipping++;
    return ok;
  });

  // Drop-ratio guard.
  if (finalSet.length < minResults) {
    // Log the under-supply event for tuning. Sentry/console picks it up.
    console.warn(
      `[KAN-190 eligibility-filter] under-supply: ${finalSet.length} candidates after filter ` +
        `(buyer=${input.buyerCountry}, recipient=${input.recipientCountry}, ` +
        `dropped_eligibility=${droppedByEligibility}, dropped_shipping=${droppedByShipping}). ` +
        `Returning pre-filter list of ${input.candidates.length} candidates.`,
    );
    return {
      candidates: input.candidates,
      droppedByEligibility,
      droppedByShipping,
      fellBackToUnfiltered: true,
    };
  }

  return {
    candidates: finalSet,
    droppedByEligibility,
    droppedByShipping,
    fellBackToUnfiltered: false,
  };
}

/**
 * Per-merchant shipping rules for MVP. Encodes "this merchant ships to
 * these countries" without the full eligibility-table lookup, because
 * shipping rules aren't yet in Sovrn's data and we already have these
 * from the merchant_detector allowlist.
 *
 * When a merchant is not in the rules table, we default to "true" (assume
 * shipping is possible) — better to over-recommend than miss a sale.
 * The Affiliate Link Service's Sovrn call will fail-soft anyway if the
 * merchant can't actually deliver.
 */
const SHIPPING_RULES: Readonly<Record<string, ReadonlySet<string>>> = {
  // Amazon — every storefront ships in-country. Cross-border via "Ships
  // internationally" works for many SKUs but isn't guaranteed; treat as
  // in-country only for the recommendation filter.
  amazon: new Set([
    'GB', 'US', 'DE', 'FR', 'IT', 'ES', 'NL', 'IE', 'CA', 'AU', 'JP',
  ]),
  etsy: new Set([
    'GB', 'US', 'DE', 'FR', 'IT', 'ES', 'NL', 'IE', 'CA', 'AU', 'JP',
  ]),
  ebay: new Set([
    'GB', 'US', 'DE', 'FR', 'IT', 'ES', 'IE', 'CA', 'AU',
  ]),
  johnlewis: new Set(['GB']),
  notonthehighstreet: new Set(['GB', 'IE']),
  bookshop_org: new Set(['GB', 'IE', 'US']),
  otto: new Set(['DE']),
};

export function canShipTo(merchantId: string, recipientCountry: string): boolean {
  const rules = SHIPPING_RULES[merchantId];
  if (!rules) return true; // unknown merchant → don't block
  return rules.has(recipientCountry.toUpperCase());
}
