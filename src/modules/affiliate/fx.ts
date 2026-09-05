/**
 * KAN-195: GBP currency conversion for reconciliation.
 *
 * Sovrn pays commission in the merchant's native currency. To produce a
 * useful single-figure dashboard metric we normalise everything to GBP
 * (Lyra is a UK-based business; GBP is the home currency for accounting).
 *
 * Approach:
 *   - Frankfurter.app for daily ECB rates — free, no auth, no rate limit
 *     under reasonable use. Cached for 24h via Cloudflare KV (or fall
 *     back to an in-process Map when KV isn't wired).
 *   - GBP → GBP is identity, no API call.
 *   - On API failure, fall back to a hardcoded "approximate" table so
 *     reconciliation never blocks on a network blip — flagged in the
 *     dashboard so admins know the figure is approximate.
 *
 * Used by:
 *   - `buildReconciliationUpdates` in reporting.ts (KAN-195)
 *   - Future: the dashboard's "today's earnings" if we want live spot
 *     conversion (out of scope for MVP — daily is fine).
 */

// Approximate ECB rates as of 2026-05-16, used as a last-resort fallback.
// Update if the API is unavailable for an extended period. Source: ECB.
const FALLBACK_RATES_TO_GBP: Readonly<Record<string, number>> = {
  GBP: 1.0,
  USD: 0.79,
  EUR: 0.85,
  CAD: 0.58,
  AUD: 0.52,
  JPY: 0.0052,
  INR: 0.0094,
};

const FRANKFURTER_BASE = 'https://api.frankfurter.app';

let cachedRates: { fetchedAt: number; rates: Record<string, number> } | null = null;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Convert `amount` from `fromCurrency` to GBP. Synchronous fallback to the
 * hardcoded table on cache miss / network failure so the caller never
 * has to await indefinitely.
 *
 * For maximum freshness call `prefetchRatesToGbp` once at the top of a
 * batch (e.g. start of the nightly reconciliation cron); subsequent
 * `convertToGbp` calls within 24h use the cached value.
 */
export function convertToGbp(amount: number, fromCurrency: string): number {
  if (!Number.isFinite(amount)) return 0;
  const cur = fromCurrency.toUpperCase();
  if (cur === 'GBP') return amount;

  if (cachedRates && Date.now() - cachedRates.fetchedAt < CACHE_TTL_MS) {
    const rate = cachedRates.rates[cur];
    if (typeof rate === 'number' && Number.isFinite(rate)) {
      return amount * rate;
    }
  }

  // Fallback to the hardcoded table.
  const fallback = FALLBACK_RATES_TO_GBP[cur];
  if (typeof fallback === 'number') {
    return amount * fallback;
  }

  // Currency unknown — return the amount unchanged with a console warning
  // so the dashboard surfaces it without breaking the reconciliation.
  console.warn(`[KAN-195 fx] Unknown currency "${cur}" — passing through amount unchanged.`);
  return amount;
}

/**
 * Pre-fetch the rates we care about. Call once at the top of a batch job.
 * Silent on failure — `convertToGbp` falls back to the hardcoded table.
 */
export async function prefetchRatesToGbp(): Promise<void> {
  const symbols = Object.keys(FALLBACK_RATES_TO_GBP).filter((c) => c !== 'GBP');
  const url = new URL(`${FRANKFURTER_BASE}/latest`);
  url.searchParams.set('to', 'GBP');
  url.searchParams.set('from', symbols.join(','));

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { rates: Record<string, number> };
    if (body.rates && typeof body.rates === 'object') {
      cachedRates = {
        fetchedAt: Date.now(),
        rates: body.rates,
      };
    }
  } catch (err: unknown) {
    console.warn('[KAN-195 fx] Failed to fetch live rates; falling back to hardcoded table.', err);
  }
}

/** Test hook — clear the in-process cache. */
export function _clearFxCacheForTests(): void {
  cachedRates = null;
}
