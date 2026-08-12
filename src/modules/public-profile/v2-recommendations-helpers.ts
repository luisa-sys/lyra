/**
 * KAN-191: pure helpers extracted from v2-recommendations-section.tsx so
 * they can be unit-tested without a DOM environment (the rest of the
 * Lyra test suite runs against Jest's `node` test environment).
 */

import type { V2Recommendation } from '@/lib/recommender/v2/types';

/**
 * Price range in human form. Returns null when no price info is available.
 *
 * Examples:
 *   { min: 1000, max: 2500, GBP } → "£10–£25"
 *   { min: 1000, max: 1000, GBP } → "from £10"
 *   { min: null, max: 5000, GBP } → "up to £50"
 *   { min: null, max: null }       → null
 */
export function formatPriceRange(
  product: Pick<V2Recommendation['product'], 'priceMinMinor' | 'priceMaxMinor' | 'priceCurrency'>,
): string | null {
  const { priceMinMinor, priceMaxMinor, priceCurrency } = product;
  if (priceMinMinor == null && priceMaxMinor == null) return null;
  const symbol =
    priceCurrency === 'GBP'
      ? '£'
      : priceCurrency === 'USD'
        ? '$'
        : priceCurrency === 'EUR'
          ? '€'
          : '';
  const fmt = (minor: number) => `${symbol}${(minor / 100).toFixed(0)}`;
  if (priceMinMinor != null && priceMaxMinor != null && priceMinMinor !== priceMaxMinor) {
    return `${fmt(priceMinMinor)}–${fmt(priceMaxMinor)}`;
  }
  if (priceMinMinor != null) return `from ${fmt(priceMinMinor)}`;
  if (priceMaxMinor != null) return `up to ${fmt(priceMaxMinor)}`;
  return null;
}

/**
 * Merchant id → human display label. Keeps the recommender's canonical
 * ids machine-readable while presenting something readable to the user.
 *
 * Unknown ids return the id itself (so the page never blanks out — better
 * to show "weirdmerchant_xyz" than nothing).
 */
export function merchantLabel(id: string): string {
  return (
    {
      amazon: 'Amazon',
      etsy: 'Etsy',
      ebay: 'eBay',
      johnlewis: 'John Lewis',
      notonthehighstreet: 'Notonthehighstreet',
      bookshop_org: 'Bookshop.org',
      otto: 'Otto',
    }[id] ?? id
  );
}
