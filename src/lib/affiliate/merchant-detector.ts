/**
 * KAN-191: detect the canonical merchant id from a URL.
 *
 * Maps known domains to the merchant_id values used by:
 *   - affiliate_merchant_eligibility (KAN-187 when seeded from Sovrn)
 *   - affiliate_clicks.merchant_id (KAN-189)
 *   - recommendation_events.merchant_id (KAN-202)
 *
 * Unknown domains return null. The link service still calls Sovrn for those
 * — Sovrn may know merchants we don't, and the eligibility filter (KAN-190)
 * is the right place to drop merchants we can't monetise.
 *
 * Allowlist approach (rather than a regex-everything heuristic): merchant
 * IDs are referenced from seed data + the curated catalogue, so the canonical
 * spellings matter. New merchants must be added explicitly here.
 *
 * NOTE: Phase 2 (KAN-196) will likely move this to be data-driven from the
 * eligibility matrix. For MVP a code-level allowlist is sufficient.
 */

type MerchantRule = {
  /** Canonical merchant_id used downstream. */
  id: string;
  /**
   * Hostname matchers. We compare against `URL(...).hostname` after
   * lowercasing and stripping a leading `www.`.
   */
  hosts: readonly string[];
};

const MERCHANT_RULES: readonly MerchantRule[] = [
  // Amazon — all storefronts share an id; the storefront is encoded in the
  // URL itself and Geniuslink/AmazonDirect (Phase 2) handle locale routing.
  {
    id: 'amazon',
    hosts: [
      'amazon.com',
      'amazon.co.uk',
      'amazon.de',
      'amazon.fr',
      'amazon.it',
      'amazon.es',
      'amazon.nl',
      'amazon.ca',
      'amazon.com.au',
      'amazon.co.jp',
      'amazon.in',
      'amazon.com.mx',
      'amazon.com.br',
      'amzn.to',
    ],
  },
  // Etsy — single global hostname; per-region UX is path-based.
  { id: 'etsy', hosts: ['etsy.com'] },
  // eBay — per-country hostnames; one id covers them all.
  {
    id: 'ebay',
    hosts: [
      'ebay.com',
      'ebay.co.uk',
      'ebay.de',
      'ebay.fr',
      'ebay.it',
      'ebay.es',
      'ebay.com.au',
      'ebay.ca',
    ],
  },
  // John Lewis — UK department store. Common gift recommendation.
  { id: 'johnlewis', hosts: ['johnlewis.com'] },
  // Notonthehighstreet — UK gifting marketplace.
  {
    id: 'notonthehighstreet',
    hosts: ['notonthehighstreet.com'],
  },
  // Bookshop.org — independent-bookseller affiliate.
  { id: 'bookshop_org', hosts: ['bookshop.org', 'uk.bookshop.org'] },
  // Otto — large DE marketplace.
  { id: 'otto', hosts: ['otto.de'] },
];

/**
 * Returns the canonical merchant id for a URL, or null if unknown.
 * Tolerant of trailing slashes, query strings, and the `www.` subdomain.
 */
export function detectMerchant(rawUrl: string): string | null {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) return null;

  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  // Strip a leading "www." so e.g. "www.etsy.com" matches "etsy.com".
  if (host.startsWith('www.')) host = host.slice(4);

  for (const rule of MERCHANT_RULES) {
    if (rule.hosts.includes(host)) {
      return rule.id;
    }
    // Allow subdomain matches: "uk.bookshop.org" is in the hosts list, but
    // "subdomain.amazon.co.uk" should still resolve to "amazon" via suffix
    // match on the listed hosts.
    for (const listed of rule.hosts) {
      if (host.endsWith(`.${listed}`)) {
        return rule.id;
      }
    }
  }
  return null;
}

/** Test helper — exposed so tests can assert on the rule shape. */
export const MERCHANT_RULES_INTERNAL = MERCHANT_RULES;
