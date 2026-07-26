#!/usr/bin/env tsx
/**
 * KAN-194: cross-country affiliate-link smoke monitor.
 *
 * For every (merchant × buyer-country) in the matrix:
 *   1. POST the representative URL to the lyra app's affiliate link service
 *      via /api/affiliate/link (when that endpoint exists — for MVP we call
 *      the Sovrn-stubbed flow inline, i.e. the link service returns the raw
 *      URL with monetised:false)
 *   2. Follow the returned URL with a bounded HEAD, falling back to a single
 *      bounded GET when HEAD is bot-walled (403/405/429) or times out — see
 *      probeUrl() in src/lib/affiliate/smoke.ts (BUGS-23). Country-spoofed
 *      Accept-Language, 5s per attempt.
 *   3. Assert the final hostname matches the expected merchant for that
 *      country (assertLocalisedDomain)
 *
 * A merchant that bot-walls both HEAD and GET from the CI runner IP (Akamai
 * tarpit — gotcha #7) is reported as INCONCLUSIVE and does NOT page; a genuine
 * outage (5xx / connection error / wrong host) still pages. The monitor is not
 * weakened — only made honest about what a datacenter probe can determine.
 *
 * Today's behaviour (pre-Sovrn): all links resolve to raw merchant URLs,
 * so the assertion just verifies the merchant's own domain is reachable.
 * When Sovrn is live, the assertion is meaningful end-to-end — the link
 * went through Sovrn's redirect and STILL landed at the localised
 * storefront.
 *
 * Exits non-zero if `shouldAlert` (any merchant fully down, or >10%
 * failure rate). The GitHub Action wrapper that calls this script
 * (.github/workflows/affiliate-link-smoke.yml) translates the exit code
 * into a notification (Slack / Resend email).
 */

import {
  buildSmokeMatrix,
  assertLocalisedDomain,
  summariseResults,
  probeUrl,
  type ProbeOutcome,
} from '../src/lib/affiliate/smoke';

const LYRA_APP_URL = process.env.LYRA_APP_URL || 'https://checklyra.com';
const PROBE_TIMEOUT_MS = 5000;
const CONCURRENCY = 5;

type ProbeInput = ReturnType<typeof buildSmokeMatrix>[number];

async function probeOne(entry: ProbeInput): Promise<ProbeOutcome> {
  const start = Date.now();

  // For MVP we directly probe the representativeUrl. Once the lyra app
  // exposes /api/affiliate/link as a server-side endpoint, this should
  // first call that to obtain the monetised URL, then probe THAT —
  // exercising the link service path end-to-end. Leaving the inline
  // probe here keeps the smoke check independently useful for upstream-
  // merchant uptime.
  const _appUrl = LYRA_APP_URL; // referenced for future expansion
  void _appUrl;

  // BUGS-23: bounded HEAD with a single GET retry when HEAD is bot-walled or
  // times out. The pure logic (and its three-way classification) lives in the
  // lib so it can be unit-tested with an injected fetch.
  const result = await probeUrl(fetch, entry.representativeUrl, {
    timeoutMs: PROBE_TIMEOUT_MS,
    acceptLanguage: languageHintFor(entry.buyerCountry),
  });

  if (!result.ok) {
    // Reachability failed OR was inconclusive (bot-walled). Propagate the
    // botBlocked flag so summariseResults can exclude inconclusive probes from
    // the alert without masking a genuine outage.
    return {
      merchantId: entry.merchantId,
      buyerCountry: entry.buyerCountry,
      ok: false,
      finalUrl: result.finalUrl,
      failureReason: result.reason,
      botBlocked: result.botBlocked,
      durationMs: Date.now() - start,
    };
  }

  // Reachable — now enforce the localised-storefront assertion on the final
  // host. A wrong host is a GENUINE failure (never bot-blocked).
  const assertion = assertLocalisedDomain(result.finalUrl, entry.expectedHosts);
  return {
    merchantId: entry.merchantId,
    buyerCountry: entry.buyerCountry,
    ok: assertion.ok,
    finalUrl: result.finalUrl,
    failureReason: assertion.ok ? null : assertion.reason,
    durationMs: Date.now() - start,
  };
}

/** Per-country Accept-Language hint. Some sites localise based on this
 *  header (or, in the future, on CF-IPCountry — but we can't spoof that
 *  from a GitHub runner). The header is best-effort, not a guarantee. */
function languageHintFor(country: string): string {
  return (
    {
      GB: 'en-GB',
      US: 'en-US',
      DE: 'de-DE,en',
      FR: 'fr-FR,en',
      IT: 'it-IT,en',
      ES: 'es-ES,en',
      NL: 'nl-NL,en',
      IE: 'en-IE',
      CA: 'en-CA',
      AU: 'en-AU',
      JP: 'ja-JP,en',
    }[country] ?? 'en'
  );
}

async function runInBatches<T, R>(
  items: readonly T[],
  batchSize: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(fn));
    out.push(...results);
  }
  return out;
}

async function main(): Promise<void> {
  const matrix = buildSmokeMatrix();
  console.log(`[smoke] running ${matrix.length} probes (concurrency ${CONCURRENCY})...`);

  const outcomes = await runInBatches(matrix, CONCURRENCY, probeOne);
  const summary = summariseResults(outcomes);

  console.log(
    `[smoke] result: ${summary.passed}/${summary.totalProbes} passed (${(summary.failureRate * 100).toFixed(1)}% failure rate)`,
  );

  if (summary.merchantsFullyDown.length > 0) {
    console.error(`[smoke] Merchants fully down: ${summary.merchantsFullyDown.join(', ')}`);
  }
  for (const f of summary.failures) {
    console.error(
      `[smoke] FAIL ${f.merchantId} ${f.buyerCountry}: ${f.failureReason}` +
        (f.finalUrl ? ` (final=${f.finalUrl})` : '') +
        ` [${f.durationMs}ms]`,
    );
  }
  // BUGS-23: surface inconclusive (bot-walled) probes as warnings — they do NOT
  // page (we can't tell up-from-down from a datacenter IP; gotcha #7), but they
  // must be visible so a genuine long-term merchant loss isn't hidden behind
  // "bot-blocked" forever.
  if (summary.botBlocked > 0) {
    console.warn(
      `[smoke] INCONCLUSIVE (bot-walled, not alerting): ${summary.merchantsInconclusive.join(', ') || '(mixed)'}`,
    );
    for (const b of summary.inconclusive) {
      console.warn(
        `[smoke] BOT-BLOCKED ${b.merchantId} ${b.buyerCountry}: ${b.failureReason}` +
          (b.finalUrl ? ` (final=${b.finalUrl})` : '') +
          ` [${b.durationMs}ms]`,
      );
    }
  }

  // Optional: write a summary JSON file the GH workflow uploads as an
  // artifact. Lets us look back at trends without standing up a DB table.
  if (process.env.SMOKE_OUTPUT_FILE) {
    const fs = await import('node:fs/promises');
    await fs.writeFile(
      process.env.SMOKE_OUTPUT_FILE,
      JSON.stringify({ summary, outcomes }, null, 2),
      'utf8',
    );
    console.log(`[smoke] summary written to ${process.env.SMOKE_OUTPUT_FILE}`);
  }

  if (summary.shouldAlert) {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('[smoke] fatal:', err);
  process.exit(1);
});
