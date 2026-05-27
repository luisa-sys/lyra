/**
 * KAN-194: pure helpers for the affiliate-link smoke monitor.
 *
 * The monitor itself (scripts/smoke-affiliate-links.ts) hits the network;
 * everything that's deterministic lives here so it can be unit-tested.
 *
 *   - buildSmokeMatrix(): expands (merchants × countries) into the test set
 *     the runner iterates over, honouring per-merchant country eligibility
 *     so we don't fire pointless probes.
 *   - assertLocalisedDomain(): the assertion that turns "I fetched the
 *     monetised URL and followed it to FOO" into "the final landing page
 *     is the right localised storefront for this country pair".
 *   - summariseResults(): rolls a flat list of probe outcomes into a
 *     pass/fail summary for the alert payload + Supabase row.
 *
 * No network access in this module. The runner injects fetch results.
 */

// ── Per-merchant probe definitions ──────────────────────────────────────
// Each merchant declares (a) a representative product URL we can use as
// the input to the link service, (b) per-country expected final hostnames.
// The hostname allowlist tolerates `m.` / `www.` / regional subdomains
// because they all resolve back to the merchant.

export type MerchantSmokeProbe = {
  merchantId: string;
  /** A real product URL that won't 404 — used as the link-service input.
   *  Falls back to this when `representativeUrlsByCountry` has no entry
   *  for the buyer-country (single-locale merchants). */
  representativeUrl: string;
  /**
   * Per-country source URL. Required for multi-locale merchants (Amazon,
   * eBay, Bookshop.org) because pre-Sovrn the runner HEAD-probes the source
   * URL directly — a US user sent to `amazon.co.uk` will NOT be redirected
   * to `amazon.com` by `Accept-Language` alone, so the probe must already
   * point at the locale-correct storefront. Post-Sovrn this still matters:
   * starting from the wrong region produces unnecessary cross-redirect noise.
   */
  representativeUrlsByCountry?: Readonly<Record<string, string>>;
  /**
   * For each (buyer-country) entry, the expected final hostname suffixes
   * the smoke check accepts. When the link service falls back to a raw URL
   * (Sovrn unconfigured), we expect the merchant's own domain. When the
   * link service generates an affiliate URL, the FINAL hostname after
   * following redirects must still be one of these.
   */
  expectedHostsByCountry: Readonly<Record<string, readonly string[]>>;
};

export const SMOKE_PROBES: readonly MerchantSmokeProbe[] = [
  {
    merchantId: 'amazon',
    representativeUrl: 'https://www.amazon.co.uk/', // GB fallback
    representativeUrlsByCountry: {
      GB: 'https://www.amazon.co.uk/',
      IE: 'https://www.amazon.co.uk/', // IE buyers commonly use the UK store; expectedHosts also allows amazon.de
      US: 'https://www.amazon.com/',
      DE: 'https://www.amazon.de/',
      FR: 'https://www.amazon.fr/',
      IT: 'https://www.amazon.it/',
      ES: 'https://www.amazon.es/',
      NL: 'https://www.amazon.nl/',
      CA: 'https://www.amazon.ca/',
      AU: 'https://www.amazon.com.au/',
      JP: 'https://www.amazon.co.jp/',
    },
    expectedHostsByCountry: {
      GB: ['amazon.co.uk'],
      IE: ['amazon.co.uk', 'amazon.de'],
      US: ['amazon.com'],
      DE: ['amazon.de'],
      FR: ['amazon.fr'],
      IT: ['amazon.it'],
      ES: ['amazon.es'],
      NL: ['amazon.nl'],
      CA: ['amazon.ca'],
      AU: ['amazon.com.au'],
      JP: ['amazon.co.jp'],
    },
  },
  {
    merchantId: 'etsy',
    representativeUrl: 'https://www.etsy.com/uk/giftcards',
    expectedHostsByCountry: {
      GB: ['etsy.com'],
      US: ['etsy.com'],
      DE: ['etsy.com'],
      FR: ['etsy.com'],
      IT: ['etsy.com'],
      ES: ['etsy.com'],
      NL: ['etsy.com'],
      IE: ['etsy.com'],
      CA: ['etsy.com'],
      AU: ['etsy.com'],
      JP: ['etsy.com'],
    },
  },
  {
    merchantId: 'ebay',
    representativeUrl: 'https://www.ebay.co.uk/', // GB fallback
    representativeUrlsByCountry: {
      GB: 'https://www.ebay.co.uk/',
      US: 'https://www.ebay.com/',
      DE: 'https://www.ebay.de/',
      FR: 'https://www.ebay.fr/',
      IT: 'https://www.ebay.it/',
      ES: 'https://www.ebay.es/',
      IE: 'https://www.ebay.co.uk/', // IE has no dedicated eBay; expectedHosts allows .co.uk + .com
      CA: 'https://www.ebay.ca/',
      AU: 'https://www.ebay.com.au/',
    },
    expectedHostsByCountry: {
      GB: ['ebay.co.uk'],
      US: ['ebay.com'],
      DE: ['ebay.de'],
      FR: ['ebay.fr'],
      IT: ['ebay.it'],
      ES: ['ebay.es'],
      IE: ['ebay.co.uk', 'ebay.com'],
      CA: ['ebay.ca'],
      AU: ['ebay.com.au'],
    },
  },
  {
    merchantId: 'johnlewis',
    representativeUrl: 'https://www.johnlewis.com/',
    expectedHostsByCountry: {
      GB: ['johnlewis.com'],
    },
  },
  {
    merchantId: 'notonthehighstreet',
    representativeUrl: 'https://www.notonthehighstreet.com/',
    expectedHostsByCountry: {
      GB: ['notonthehighstreet.com'],
      IE: ['notonthehighstreet.com'],
    },
  },
  {
    merchantId: 'bookshop_org',
    representativeUrl: 'https://uk.bookshop.org/gift-cards', // GB fallback
    representativeUrlsByCountry: {
      GB: 'https://uk.bookshop.org/gift-cards',
      IE: 'https://uk.bookshop.org/gift-cards',
      US: 'https://bookshop.org/gift-cards',
    },
    expectedHostsByCountry: {
      GB: ['uk.bookshop.org', 'bookshop.org'],
      IE: ['uk.bookshop.org', 'bookshop.org'],
      US: ['bookshop.org'],
    },
  },
  {
    merchantId: 'otto',
    representativeUrl: 'https://www.otto.de/',
    expectedHostsByCountry: {
      DE: ['otto.de'],
    },
  },
];

// ── Matrix expansion ────────────────────────────────────────────────────

export type SmokeMatrixEntry = {
  merchantId: string;
  representativeUrl: string;
  buyerCountry: string;
  expectedHosts: readonly string[];
};

/** Expand SMOKE_PROBES into a flat list of test cases. The per-entry
 *  source URL prefers `representativeUrlsByCountry[country]` when present
 *  (multi-locale merchants) and falls back to `representativeUrl`. */
export function buildSmokeMatrix(): SmokeMatrixEntry[] {
  const out: SmokeMatrixEntry[] = [];
  for (const probe of SMOKE_PROBES) {
    for (const [country, hosts] of Object.entries(probe.expectedHostsByCountry)) {
      const perCountry = probe.representativeUrlsByCountry?.[country];
      out.push({
        merchantId: probe.merchantId,
        representativeUrl: perCountry ?? probe.representativeUrl,
        buyerCountry: country,
        expectedHosts: hosts,
      });
    }
  }
  return out;
}

// ── Final-domain assertion ──────────────────────────────────────────────

/**
 * Given the final URL the redirect chain resolved to, check it's one of
 * the expected hosts for this country. Tolerant of `www.` and `m.`
 * subdomains; tolerant of unmatched-but-related TLDs only if explicitly
 * listed (no fuzzy matching — typos in the allowlist must surface).
 */
export function assertLocalisedDomain(
  finalUrl: string,
  expectedHosts: readonly string[],
): { ok: true } | { ok: false; reason: string; actualHost: string | null } {
  if (!finalUrl || typeof finalUrl !== 'string') {
    return { ok: false, reason: 'no_final_url', actualHost: null };
  }

  let host: string;
  try {
    host = new URL(finalUrl).hostname.toLowerCase();
  } catch {
    return { ok: false, reason: 'invalid_url', actualHost: null };
  }

  // Strip leading `www.` or `m.` for matching.
  const stripped = host.replace(/^(www|m)\./, '');

  for (const expected of expectedHosts) {
    const exp = expected.toLowerCase();
    if (stripped === exp) return { ok: true };
    if (stripped.endsWith(`.${exp}`)) return { ok: true };
  }

  return { ok: false, reason: 'unexpected_host', actualHost: host };
}

// ── Probe result + summary ──────────────────────────────────────────────

export type ProbeOutcome = {
  merchantId: string;
  buyerCountry: string;
  ok: boolean;
  /** Final URL after following redirects, if reached. */
  finalUrl: string | null;
  /** Why it failed, if it failed. */
  failureReason: string | null;
  /** Total wall-clock ms for the probe. */
  durationMs: number;
};

export type SmokeRunSummary = {
  totalProbes: number;
  passed: number;
  failed: number;
  failureRate: number; // 0-1
  failures: ProbeOutcome[];
  /** Whether this run should trigger an alert (failure rate over threshold OR any merchant fully down). */
  shouldAlert: boolean;
  /** Per-merchant uptime: was every country probe for this merchant a pass? */
  merchantsFullyDown: readonly string[];
};

/**
 * Roll up a flat list of probe outcomes into a summary. The alert decision
 * is conservative: if ANY merchant has zero successful probes across all
 * its countries, that's a structural failure (e.g. the merchant program
 * has been pulled) and should page on-call. A 1-in-50 transient blip
 * across the full matrix shouldn't.
 */
export function summariseResults(outcomes: readonly ProbeOutcome[]): SmokeRunSummary {
  const total = outcomes.length;
  const failures = outcomes.filter((o) => !o.ok);
  const passed = total - failures.length;
  const failureRate = total > 0 ? failures.length / total : 0;

  // Per-merchant pass/fail.
  const perMerchantTotals = new Map<string, { passed: number; total: number }>();
  for (const o of outcomes) {
    let bucket = perMerchantTotals.get(o.merchantId);
    if (!bucket) {
      bucket = { passed: 0, total: 0 };
      perMerchantTotals.set(o.merchantId, bucket);
    }
    bucket.total += 1;
    if (o.ok) bucket.passed += 1;
  }
  const merchantsFullyDown = [...perMerchantTotals.entries()]
    .filter(([, t]) => t.total > 0 && t.passed === 0)
    .map(([m]) => m);

  // Alert if any merchant is fully down OR failure rate > 10% overall.
  const shouldAlert = merchantsFullyDown.length > 0 || failureRate > 0.1;

  return {
    totalProbes: total,
    passed,
    failed: failures.length,
    failureRate,
    failures,
    shouldAlert,
    merchantsFullyDown,
  };
}
