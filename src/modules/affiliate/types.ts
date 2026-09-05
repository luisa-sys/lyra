/**
 * KAN-189: types + helpers for the `affiliate_clicks` table.
 *
 * The full Affiliate Link Service (KAN-188) is not yet implemented — this
 * module defines the shapes and the SubID convention so future work
 * (KAN-191 web rendering, KAN-201 MCP rendering, KAN-195 reconciliation)
 * can import the canonical types.
 *
 * The SubID is what we send to the affiliate provider (Sovrn etc.) so they
 * echo it back in their reports. It is the join key in monthly reconciliation
 * (KAN-195). It must be opaque (no PII) and source-tagged so MCP traffic can
 * be split from web traffic.
 */

export type AffiliateProvider = 'sovrn' | 'amazon_direct' | 'geniuslink' | 'raw';
export type AffiliateClickSource = 'web' | 'mcp' | 'email';

export type AffiliateClickRow = {
  click_id: string;
  created_at: string;
  session_id: string | null;
  user_id: string | null;
  recipient_id: string | null;
  recommendation_id: string | null;
  merchant_id: string | null;
  buyer_country: string | null;
  recipient_country: string | null;
  provider: AffiliateProvider;
  provider_subid: string | null;
  source: AffiliateClickSource;
  raw_url: string;
  monetised_url: string;
  converted_at: string | null;
  commission_amount: string | null;
  commission_currency: string | null;
  commission_gbp: string | null;
};

/**
 * Build the SubID string we send to the affiliate provider. The format is
 * `lyra-{click_id}` for web/email and `lyra-mcp-{click_id}` for MCP so the
 * reconciliation cron can split traffic without an extra join.
 *
 * The provider echoes this back unchanged in its monthly report.
 */
export function buildSubId(clickId: string, source: AffiliateClickSource): string {
  if (source === 'mcp') {
    return `lyra-mcp-${clickId}`;
  }
  return `lyra-${clickId}`;
}

/**
 * Extract the click_id from a SubID. Returns null if the input is not in our
 * format — the reconciliation cron uses this to identify which rows in the
 * provider's report originated from us vs. from any other publisher.
 */
export function parseSubId(subId: string | null | undefined): {
  clickId: string;
  source: AffiliateClickSource;
} | null {
  if (!subId || typeof subId !== 'string') return null;
  // MCP-prefixed: lyra-mcp-{uuid}
  const mcpMatch = subId.match(/^lyra-mcp-([0-9a-f-]{36})$/);
  if (mcpMatch) {
    return { clickId: mcpMatch[1], source: 'mcp' };
  }
  // Web/email: lyra-{uuid} (no further hyphen-prefix)
  const webMatch = subId.match(/^lyra-([0-9a-f-]{36})$/);
  if (webMatch) {
    // Disambiguation: source is either 'web' or 'email'. We default to 'web'
    // because the SubID alone cannot distinguish — the source is recorded
    // in the affiliate_clicks row, which the reconciliation joins on click_id.
    return { clickId: webMatch[1], source: 'web' };
  }
  return null;
}

/**
 * Type guard for the ISO-3166 alpha-2 country format the schema enforces.
 * Keep aligned with the check constraint in the migration.
 */
export function isCountryCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{2}$/.test(value);
}
