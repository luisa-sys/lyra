/**
 * KAN-482 — DPIA §2a AD-6: the /search term must not leak through the
 * Referer of the page a visitor goes to next. /search is a GET form, so the
 * term is in its URL; under the site-wide `strict-origin-when-cross-origin`
 * policy a same-origin navigation (e.g. a second search, or opening a result)
 * would carry `Referer: …/search?q=<term>`, and `document.referrer` on the
 * next page would hold it — the Sentry browser SDK copies that into events
 * and analytics scripts can read it.
 *
 * Behavioural: calls the real `headers()` from next.config.ts and resolves the
 * effective value the way Next.js does (for the same key, the LAST matching
 * entry wins), so moving the /search entry above the catch-all, dropping it,
 * or weakening its value goes red.
 */

jest.mock('@sentry/nextjs', () => ({ withSentryConfig: (c: unknown) => c }));

type HeaderEntry = { source: string; headers: { key: string; value: string }[] };

/** Minimal Next.js source matcher for the two patterns this config uses. */
function matches(source: string, path: string): boolean {
  if (source === '/(.*)') return true;
  return source === path;
}

async function effectiveHeader(path: string, key: string): Promise<string | undefined> {
  const mod = await import('../../next.config');
  const entries = (await mod.default.headers!()) as HeaderEntry[];
  let value: string | undefined;
  for (const e of entries) {
    if (!matches(e.source, path)) continue;
    for (const h of e.headers) if (h.key.toLowerCase() === key.toLowerCase()) value = h.value;
  }
  return value;
}

describe('Referrer-Policy on /search (KAN-482 AD-6)', () => {
  it('sends the origin only from /search, so the term never becomes a Referer', async () => {
    expect(await effectiveHeader('/search', 'Referrer-Policy')).toBe('strict-origin');
  });

  it('leaves the site-wide policy unchanged elsewhere (positive control)', async () => {
    expect(await effectiveHeader('/dashboard', 'Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });
});
