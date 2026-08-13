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
    // `/gift-cards` returned 404 across all locales in May 2026 — the page
    // was deprecated. Switch the probe to the regional homepage, which
    // 200s on HEAD and reliably resolves to the correct locale.
    representativeUrl: 'https://uk.bookshop.org/', // GB fallback
    representativeUrlsByCountry: {
      GB: 'https://uk.bookshop.org/',
      IE: 'https://uk.bookshop.org/',
      US: 'https://bookshop.org/',
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

// ── Network probe: HEAD → GET fallback, bot-block aware (BUGS-23) ─────────
//
// John Lewis (and any Akamai-fronted merchant) tarpits datacenter/CI-IP HEAD
// requests (gotcha #7: "GitHub Actions runner IPs are blocked by Cloudflare
// bot protection"). A single HEAD that aborts at the timeout was being scored
// as "merchant fully down" → a false page. But we must NOT mask a real outage.
//
// probeUrl() therefore distinguishes THREE outcomes:
//   - reachable (ok:true)         — HEAD or the GET retry returned 2xx.
//   - inconclusive (botBlocked)   — BOTH HEAD and GET hit a bot-wall signal
//                                   (timeout / 403 / 429). From a datacenter
//                                   IP we cannot tell up-from-down, so this is
//                                   surfaced but does NOT page.
//   - genuine failure (ok:false)  — a determinate error (5xx, 4xx that isn't a
//                                   bot-wall, wrong host, connection/DNS error).
//                                   This still pages.
// A timeout is never treated as a pass; only a real 2xx flips to ok:true.

/** Injectable fetch so the probe is unit-testable without the network. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** HEAD statuses that trigger a single GET retry (host up but hostile to HEAD). */
const HEAD_RETRY_STATUSES = new Set([403, 405, 429]);
/** Statuses that, when they ALSO come back on the GET retry, mean "bot-walled"
 *  (inconclusive) rather than a confirmed outage. 405 is deliberately excluded
 *  here — a GET that is Method-Not-Allowed on a storefront homepage is a real
 *  misconfiguration, not a bot wall. */
const BOT_WALL_STATUSES = new Set([403, 429]);

export type ProbeResult =
  | { ok: true; finalUrl: string }
  | { ok: false; botBlocked: boolean; reason: string; finalUrl: string | null };

async function attemptFetch(
  fetchImpl: FetchLike,
  url: string,
  method: 'HEAD' | 'GET',
  timeoutMs: number,
  acceptLanguage: string,
): Promise<{ status: number; ok: boolean; finalUrl: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      // On GET, ask for only the first byte so we don't drain a full page body.
      headers:
        method === 'GET'
          ? { 'Accept-Language': acceptLanguage, Range: 'bytes=0-0' }
          : { 'Accept-Language': acceptLanguage },
    });
    // We only care about status + final URL; release the body promptly.
    try {
      await res.body?.cancel?.();
    } catch {
      /* body already consumed / unsupported — ignore */
    }
    return { status: res.status, ok: res.ok, finalUrl: res.url || url };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe a merchant URL with a bounded HEAD, falling back to a single bounded
 * GET when HEAD is blocked or times out. See the section comment above for the
 * three-way classification. `fetchImpl` is injected so this is unit-testable.
 */
export async function probeUrl(
  fetchImpl: FetchLike,
  url: string,
  opts: { timeoutMs: number; acceptLanguage: string },
): Promise<ProbeResult> {
  // ── Attempt 1: HEAD ──
  try {
    const h = await attemptFetch(fetchImpl, url, 'HEAD', opts.timeoutMs, opts.acceptLanguage);
    if (h.ok) return { ok: true, finalUrl: h.finalUrl };
    if (!HEAD_RETRY_STATUSES.has(h.status)) {
      // 5xx, 404, 410, … — a determinate problem, not a bot wall. Do not rescue.
      return { ok: false, botBlocked: false, reason: `head_http_${h.status}`, finalUrl: h.finalUrl };
    }
    // 403/405/429 → fall through to a single GET retry.
  } catch (e) {
    if (!(e instanceof Error && e.name === 'AbortError')) {
      // A non-timeout error (DNS, connection refused, TLS) is a real failure.
      return {
        ok: false,
        botBlocked: false,
        reason: e instanceof Error ? `error:${e.message.slice(0, 60)}` : 'unknown_error',
        finalUrl: null,
      };
    }
    // HEAD timed out (tarpit) → fall through to the GET retry.
  }

  // ── Attempt 2: GET (single bounded retry) ──
  try {
    const g = await attemptFetch(fetchImpl, url, 'GET', opts.timeoutMs, opts.acceptLanguage);
    if (g.ok) return { ok: true, finalUrl: g.finalUrl };
    if (BOT_WALL_STATUSES.has(g.status)) {
      // Still bot-walled on GET → inconclusive from a datacenter IP, not down.
      return { ok: false, botBlocked: true, reason: `bot_blocked_http_${g.status}`, finalUrl: g.finalUrl };
    }
    // GET returned a determinate error (5xx / 404 / 405 / …) → genuine failure.
    return { ok: false, botBlocked: false, reason: `get_http_${g.status}`, finalUrl: g.finalUrl };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      // Both HEAD and GET timed out → datacenter tarpit; inconclusive, not down.
      return { ok: false, botBlocked: true, reason: 'bot_blocked_timeout', finalUrl: null };
    }
    return {
      ok: false,
      botBlocked: false,
      reason: e instanceof Error ? `error:${e.message.slice(0, 60)}` : 'unknown_error',
      finalUrl: null,
    };
  }
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
  /**
   * BUGS-23: true when the probe was INCONCLUSIVE because the merchant
   * bot-walled both HEAD and GET (timeout / 403 / 429) — up-vs-down cannot be
   * determined from a datacenter/CI IP (gotcha #7). Such a probe is surfaced
   * but does NOT count toward the alert. Absent/false for a genuine failure.
   */
  botBlocked?: boolean;
  /** Total wall-clock ms for the probe. */
  durationMs: number;
};

export type SmokeRunSummary = {
  totalProbes: number;
  passed: number;
  /** Count of GENUINE failures (excludes inconclusive bot-walled probes). */
  failed: number;
  /** BUGS-23: count of INCONCLUSIVE (bot-walled) probes — surfaced, not paged. */
  botBlocked: number;
  /** Genuine-failure rate over the ASSESSABLE probes (bot-walled excluded from
   *  both numerator and denominator). 0-1. */
  failureRate: number;
  /** Genuine failures only — the outcomes the alert is based on. */
  failures: ProbeOutcome[];
  /** BUGS-23: inconclusive (bot-walled) probes, surfaced for visibility. */
  inconclusive: ProbeOutcome[];
  /** Whether this run should trigger an alert (genuine failure rate over threshold OR any merchant genuinely fully down). */
  shouldAlert: boolean;
  /** Per-merchant: zero passes AND at least one GENUINE failure (a real outage). */
  merchantsFullyDown: readonly string[];
  /** BUGS-23: per-merchant zero passes with ONLY bot-walled probes — unverifiable, not paged. */
  merchantsInconclusive: readonly string[];
};

/**
 * Roll up a flat list of probe outcomes into a summary. The alert decision
 * is conservative: if ANY merchant has zero successful probes AND at least one
 * GENUINE (determinate) failure across its countries, that's a structural
 * failure (e.g. the merchant program has been pulled) and should page on-call.
 * A 1-in-50 transient blip across the full matrix shouldn't.
 *
 * BUGS-23: probes that came back INCONCLUSIVE because the merchant bot-walled
 * both HEAD and GET (timeout / 403 / 429 from a datacenter IP — gotcha #7) are
 * NOT counted as failures for the alert decision. They are surfaced separately
 * (`inconclusive` / `merchantsInconclusive`) so a human can see them, but they
 * do not page — because we genuinely cannot tell up-from-down from CI. A real
 * outage (5xx, connection refused, wrong host) is still a genuine failure and
 * still pages: the monitor is not weakened, only made honest.
 */
export function summariseResults(outcomes: readonly ProbeOutcome[]): SmokeRunSummary {
  const total = outcomes.length;
  const botBlocked = outcomes.filter((o) => !o.ok && o.botBlocked === true);
  const genuineFailures = outcomes.filter((o) => !o.ok && o.botBlocked !== true);
  const passed = outcomes.filter((o) => o.ok).length;

  // Failure rate is over ASSESSABLE probes only — an inconclusive bot-wall is
  // neither a pass nor a fail, so it must not inflate (or deflate) the rate.
  const assessable = total - botBlocked.length;
  const failureRate = assessable > 0 ? genuineFailures.length / assessable : 0;

  // Per-merchant tally.
  const perMerchant = new Map<
    string,
    { passed: number; genuineFail: number; botBlocked: number; total: number }
  >();
  for (const o of outcomes) {
    let bucket = perMerchant.get(o.merchantId);
    if (!bucket) {
      bucket = { passed: 0, genuineFail: 0, botBlocked: 0, total: 0 };
      perMerchant.set(o.merchantId, bucket);
    }
    bucket.total += 1;
    if (o.ok) bucket.passed += 1;
    else if (o.botBlocked === true) bucket.botBlocked += 1;
    else bucket.genuineFail += 1;
  }
  // Fully down = zero passes AND at least one genuine failure (a real outage).
  const merchantsFullyDown = [...perMerchant.entries()]
    .filter(([, t]) => t.passed === 0 && t.genuineFail > 0)
    .map(([m]) => m);
  // Inconclusive = zero passes, no genuine failures, only bot-walls.
  const merchantsInconclusive = [...perMerchant.entries()]
    .filter(([, t]) => t.passed === 0 && t.genuineFail === 0 && t.botBlocked > 0)
    .map(([m]) => m);

  // Alert if any merchant is genuinely fully down OR genuine failure rate > 10%.
  const shouldAlert = merchantsFullyDown.length > 0 || failureRate > 0.1;

  return {
    totalProbes: total,
    passed,
    failed: genuineFailures.length,
    botBlocked: botBlocked.length,
    failureRate,
    failures: genuineFailures,
    inconclusive: botBlocked,
    shouldAlert,
    merchantsFullyDown,
    merchantsInconclusive,
  };
}
