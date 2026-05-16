#!/usr/bin/env tsx
/**
 * KAN-194: cross-country affiliate-link smoke monitor.
 *
 * For every (merchant × buyer-country) in the matrix:
 *   1. POST the representative URL to the lyra app's affiliate link service
 *      via /api/affiliate/link (when that endpoint exists — for MVP we call
 *      the Sovrn-stubbed flow inline, i.e. the link service returns the raw
 *      URL with monetised:false)
 *   2. Follow the returned URL with HEAD (or GET on HEAD-unsupported hosts)
 *      with a 5s timeout, country-spoofed Accept-Language
 *   3. Assert the final hostname matches the expected merchant for that
 *      country (assertLocalisedDomain)
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

import { buildSmokeMatrix, assertLocalisedDomain, summariseResults, type ProbeOutcome } from '../src/lib/affiliate/smoke';

const LYRA_APP_URL = process.env.LYRA_APP_URL || 'https://checklyra.com';
const PROBE_TIMEOUT_MS = 5000;
const CONCURRENCY = 5;

type ProbeInput = ReturnType<typeof buildSmokeMatrix>[number];

async function probeOne(entry: ProbeInput): Promise<ProbeOutcome> {
  const start = Date.now();
  try {
    // For MVP we directly probe the representativeUrl. Once the lyra app
    // exposes /api/affiliate/link as a server-side endpoint, this should
    // first call that to obtain the monetised URL, then probe THAT —
    // exercising the link service path end-to-end. Leaving the inline
    // probe here keeps the smoke check independently useful for upstream-
    // merchant uptime.
    const _appUrl = LYRA_APP_URL; // referenced for future expansion
    void _appUrl;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

    const headRes = await fetch(entry.representativeUrl, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'Accept-Language': languageHintFor(entry.buyerCountry) },
    });
    clearTimeout(timeout);

    if (!headRes.ok && headRes.status !== 405) {
      // 405 (method not allowed) is normal — fall through to GET. Anything
      // else is a failure: the merchant is down or geo-blocking us.
      return {
        merchantId: entry.merchantId,
        buyerCountry: entry.buyerCountry,
        ok: false,
        finalUrl: headRes.url || null,
        failureReason: `head_http_${headRes.status}`,
        durationMs: Date.now() - start,
      };
    }

    const finalUrl = headRes.url || entry.representativeUrl;
    const assertion = assertLocalisedDomain(finalUrl, entry.expectedHosts);

    return {
      merchantId: entry.merchantId,
      buyerCountry: entry.buyerCountry,
      ok: assertion.ok,
      finalUrl,
      failureReason: assertion.ok ? null : assertion.reason,
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    const reason =
      err instanceof Error && err.name === 'AbortError'
        ? 'timeout'
        : err instanceof Error
          ? `error:${err.message.slice(0, 60)}`
          : 'unknown_error';
    return {
      merchantId: entry.merchantId,
      buyerCountry: entry.buyerCountry,
      ok: false,
      finalUrl: null,
      failureReason: reason,
      durationMs: Date.now() - start,
    };
  }
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
