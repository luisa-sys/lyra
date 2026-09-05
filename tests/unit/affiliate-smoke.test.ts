/**
 * KAN-194: tests for the smoke-monitor pure helpers.
 *
 * The runner that hits the network is exercised at deploy time (the
 * scheduled workflow's first run); the pure logic — what we probe, how
 * we assert, how we summarise — lives here.
 */

import {
  SMOKE_PROBES,
  buildSmokeMatrix,
  assertLocalisedDomain,
  summariseResults,
  probeUrl,
  type ProbeOutcome,
  type FetchLike,
} from '@/modules/affiliate/smoke';

// ── SMOKE_PROBES shape ─────────────────────────────────────────────────

describe('KAN-194 SMOKE_PROBES — invariants', () => {
  test('every probe has a representative URL with the merchant\'s root domain', () => {
    for (const p of SMOKE_PROBES) {
      const u = new URL(p.representativeUrl);
      expect(u.hostname.length).toBeGreaterThan(0);
    }
  });

  test('every country in expectedHostsByCountry is ISO-3166 alpha-2', () => {
    for (const p of SMOKE_PROBES) {
      for (const c of Object.keys(p.expectedHostsByCountry)) {
        expect(c).toMatch(/^[A-Z]{2}$/);
      }
    }
  });

  test('every expected host is a domain (no protocol, no path)', () => {
    for (const p of SMOKE_PROBES) {
      for (const hosts of Object.values(p.expectedHostsByCountry)) {
        for (const h of hosts) {
          expect(h).not.toMatch(/^https?:\/\//);
          expect(h).not.toContain('/');
        }
      }
    }
  });

  test('covers all merchants from the merchant_detector allowlist (KAN-191)', () => {
    const merchantIds = SMOKE_PROBES.map((p) => p.merchantId);
    for (const m of ['amazon', 'etsy', 'ebay', 'johnlewis', 'notonthehighstreet', 'bookshop_org', 'otto']) {
      expect(merchantIds).toContain(m);
    }
  });

  test('Amazon covers the Earn Globally umbrella (GB + DE + FR + IT + ES)', () => {
    const amazon = SMOKE_PROBES.find((p) => p.merchantId === 'amazon');
    expect(amazon).toBeDefined();
    for (const c of ['GB', 'DE', 'FR', 'IT', 'ES']) {
      expect(amazon?.expectedHostsByCountry[c]).toBeDefined();
    }
  });
});

// ── buildSmokeMatrix ───────────────────────────────────────────────────

describe('KAN-194 buildSmokeMatrix', () => {
  test('expands every (merchant, country) pair', () => {
    const matrix = buildSmokeMatrix();
    const expected = SMOKE_PROBES.reduce(
      (sum, p) => sum + Object.keys(p.expectedHostsByCountry).length,
      0,
    );
    expect(matrix.length).toBe(expected);
  });

  test('every entry has merchantId + buyerCountry + expectedHosts', () => {
    const matrix = buildSmokeMatrix();
    for (const m of matrix) {
      expect(m.merchantId).toBeTruthy();
      expect(m.buyerCountry).toMatch(/^[A-Z]{2}$/);
      expect(m.expectedHosts.length).toBeGreaterThan(0);
      expect(m.representativeUrl).toContain('://');
    }
  });

  // Pre-Sovrn the runner HEAD-probes representativeUrl directly. Sending
  // amazon.co.uk to a US user doesn't redirect to amazon.com (Accept-
  // Language alone won't move you off a regional storefront), so each
  // (merchant × locale) needs its own source URL.
  test('Amazon uses the locale-matching domain in each matrix row', () => {
    const matrix = buildSmokeMatrix().filter((m) => m.merchantId === 'amazon');
    const byCountry = Object.fromEntries(matrix.map((m) => [m.buyerCountry, m.representativeUrl]));
    expect(byCountry.US).toContain('amazon.com/');
    expect(byCountry.DE).toContain('amazon.de/');
    expect(byCountry.FR).toContain('amazon.fr/');
    expect(byCountry.JP).toContain('amazon.co.jp/');
    expect(byCountry.GB).toContain('amazon.co.uk/');
  });

  test('eBay uses the locale-matching domain in each matrix row', () => {
    const matrix = buildSmokeMatrix().filter((m) => m.merchantId === 'ebay');
    const byCountry = Object.fromEntries(matrix.map((m) => [m.buyerCountry, m.representativeUrl]));
    expect(byCountry.US).toContain('ebay.com/');
    expect(byCountry.DE).toContain('ebay.de/');
    expect(byCountry.AU).toContain('ebay.com.au/');
  });

  test('Bookshop.org sends US buyers to bookshop.org, not uk.bookshop.org', () => {
    const matrix = buildSmokeMatrix().filter((m) => m.merchantId === 'bookshop_org');
    const us = matrix.find((m) => m.buyerCountry === 'US');
    expect(us?.representativeUrl).toContain('://bookshop.org/');
    expect(us?.representativeUrl).not.toContain('uk.bookshop.org');
  });

  test('single-locale merchants fall back to representativeUrl (no per-country override)', () => {
    // John Lewis (GB only), Etsy (etsy.com globally) shouldn't need per-country URLs.
    const matrix = buildSmokeMatrix();
    const jl = matrix.find((m) => m.merchantId === 'johnlewis' && m.buyerCountry === 'GB');
    expect(jl?.representativeUrl).toContain('johnlewis.com');
    for (const m of matrix.filter((x) => x.merchantId === 'etsy')) {
      expect(m.representativeUrl).toContain('etsy.com');
    }
  });

  test('every country listed in representativeUrlsByCountry is also in expectedHostsByCountry', () => {
    for (const p of SMOKE_PROBES) {
      if (!p.representativeUrlsByCountry) continue;
      const expectedCountries = new Set(Object.keys(p.expectedHostsByCountry));
      for (const c of Object.keys(p.representativeUrlsByCountry)) {
        expect(expectedCountries.has(c)).toBe(true);
      }
    }
  });
});

// ── assertLocalisedDomain ──────────────────────────────────────────────

describe('KAN-194 assertLocalisedDomain — happy path', () => {
  test('accepts an exact host match', () => {
    expect(assertLocalisedDomain('https://amazon.co.uk/dp/x', ['amazon.co.uk'])).toEqual({ ok: true });
  });

  test('strips www. before matching', () => {
    expect(assertLocalisedDomain('https://www.amazon.co.uk/dp/x', ['amazon.co.uk'])).toEqual({ ok: true });
  });

  test('strips m. before matching', () => {
    expect(assertLocalisedDomain('https://m.amazon.co.uk/dp/x', ['amazon.co.uk'])).toEqual({ ok: true });
  });

  test('accepts a subdomain that suffix-matches', () => {
    // e.g. CDN subdomain `images.amazon.co.uk` resolves to amazon.
    expect(assertLocalisedDomain('https://images.amazon.co.uk/x', ['amazon.co.uk'])).toEqual({ ok: true });
  });

  test('accepts when any expected host matches', () => {
    expect(assertLocalisedDomain('https://etsy.com/x', ['etsy.com', 'etsy.de'])).toEqual({ ok: true });
  });
});

describe('KAN-194 assertLocalisedDomain — failure paths', () => {
  test('rejects when the host is not in the expected list', () => {
    const out = assertLocalisedDomain('https://amazon.com/x', ['amazon.co.uk']);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe('unexpected_host');
      expect(out.actualHost).toBe('amazon.com');
    }
  });

  test('rejects malformed URLs gracefully', () => {
    const out = assertLocalisedDomain('not-a-url', ['amazon.co.uk']);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('invalid_url');
  });

  test('rejects empty / non-string input', () => {
    const out1 = assertLocalisedDomain('', ['amazon.co.uk']);
    expect(out1.ok).toBe(false);
    // @ts-expect-error — runtime guard
    const out2 = assertLocalisedDomain(null, ['amazon.co.uk']);
    expect(out2.ok).toBe(false);
  });

  test('does NOT fuzzy-match against a near-domain (typo guard)', () => {
    // If a typo in the allowlist resolves silently, we never catch real
    // breakages. So `fakeamazon.co.uk` does NOT match `amazon.co.uk`.
    const out = assertLocalisedDomain('https://fakeamazon.co.uk/x', ['amazon.co.uk']);
    expect(out.ok).toBe(false);
  });
});

// ── summariseResults ────────────────────────────────────────────────────

function passing(merchantId: string, country: string): ProbeOutcome {
  return {
    merchantId,
    buyerCountry: country,
    ok: true,
    finalUrl: `https://${merchantId}.example/x`,
    failureReason: null,
    durationMs: 100,
  };
}

function failing(merchantId: string, country: string, reason = 'timeout'): ProbeOutcome {
  return {
    merchantId,
    buyerCountry: country,
    ok: false,
    finalUrl: null,
    failureReason: reason,
    durationMs: 5000,
  };
}

describe('KAN-194 summariseResults', () => {
  test('all passing → no alert, no merchants down', () => {
    const out = summariseResults([passing('amazon', 'GB'), passing('etsy', 'GB')]);
    expect(out.passed).toBe(2);
    expect(out.failed).toBe(0);
    expect(out.failureRate).toBe(0);
    expect(out.shouldAlert).toBe(false);
    expect(out.merchantsFullyDown).toEqual([]);
  });

  test('all failing → alert, all merchants marked down', () => {
    const out = summariseResults([failing('amazon', 'GB'), failing('etsy', 'GB')]);
    expect(out.failed).toBe(2);
    expect(out.failureRate).toBe(1);
    expect(out.shouldAlert).toBe(true);
    expect(new Set(out.merchantsFullyDown)).toEqual(new Set(['amazon', 'etsy']));
  });

  test('one merchant fully down (one of two) → alert', () => {
    const out = summariseResults([
      passing('amazon', 'GB'),
      passing('amazon', 'US'),
      failing('etsy', 'GB'),
    ]);
    expect(out.merchantsFullyDown).toEqual(['etsy']);
    expect(out.shouldAlert).toBe(true);
  });

  test('low transient failure rate (<10%) → no alert', () => {
    // 1 fail out of 20 = 5% failure rate, no merchant fully down.
    const outcomes: ProbeOutcome[] = [];
    for (let i = 0; i < 19; i++) outcomes.push(passing('amazon', 'GB'));
    outcomes.push(failing('etsy', 'GB'));
    outcomes.push(passing('etsy', 'US')); // makes etsy not fully-down
    const out = summariseResults(outcomes);
    expect(out.shouldAlert).toBe(false);
  });

  test('high transient failure rate (>10%) → alert', () => {
    // 3 fail out of 20 = 15% > 10%; no merchant fully down.
    const outcomes: ProbeOutcome[] = [];
    for (let i = 0; i < 17; i++) outcomes.push(passing('amazon', 'GB'));
    outcomes.push(failing('etsy', 'GB'));
    outcomes.push(failing('etsy', 'US'));
    outcomes.push(failing('etsy', 'DE'));
    // etsy would be fully-down here. Add a pass to defuse that.
    outcomes.push(passing('etsy', 'FR'));
    const out = summariseResults(outcomes);
    expect(out.shouldAlert).toBe(true);
  });

  test('empty input → safe defaults, no alert', () => {
    const out = summariseResults([]);
    expect(out.totalProbes).toBe(0);
    expect(out.failureRate).toBe(0);
    expect(out.shouldAlert).toBe(false);
    expect(out.failures).toEqual([]);
  });

  test('includes the failed outcomes in the summary for the alert body', () => {
    const failed = failing('amazon', 'GB', 'unexpected_host');
    const out = summariseResults([passing('etsy', 'GB'), failed]);
    expect(out.failures).toContain(failed);
  });
});

// ── BUGS-23: probeUrl (HEAD → GET fallback, bot-block aware) ─────────────

type FetchBehavior = { status: number; url?: string } | 'timeout' | { error: string };

/**
 * Build a fake fetch that plays a queued list of behaviours (one per call,
 * so [HEAD-behaviour, GET-behaviour]). 'timeout' honours the AbortController
 * signal so attemptFetch's real timer produces a realistic AbortError.
 */
function makeFetch(behaviours: FetchBehavior[]): {
  impl: FetchLike;
  calls: Array<{ url: string; method: string }>;
} {
  const calls: Array<{ url: string; method: string }> = [];
  let i = 0;
  const impl: FetchLike = (url, init) => {
    calls.push({ url, method: (init.method as string) || 'GET' });
    const b = behaviours[i++] ?? { status: 200 };
    if (b === 'timeout') {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init.signal as AbortSignal | undefined;
        signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }
    if ('error' in b) return Promise.reject(new Error(b.error));
    const status = b.status;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      url: b.url ?? url,
      body: undefined,
    } as unknown as Response);
  };
  return { impl, calls };
}

const OPTS = { timeoutMs: 20, acceptLanguage: 'en-GB' };
const URL_UNDER_TEST = 'https://www.johnlewis.com/';

describe('BUGS-23 probeUrl — HEAD→GET fallback, bot-block aware', () => {
  test('HEAD 200 → ok, single request (no GET)', async () => {
    const { impl, calls } = makeFetch([{ status: 200 }]);
    const r = await probeUrl(impl, URL_UNDER_TEST, OPTS);
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('HEAD');
  });

  test('HEAD timeout → GET 200 → ok, exactly two requests (the johnlewis rescue)', async () => {
    const { impl, calls } = makeFetch(['timeout', { status: 200 }]);
    const r = await probeUrl(impl, URL_UNDER_TEST, OPTS);
    expect(r.ok).toBe(true);
    expect(calls.map((c) => c.method)).toEqual(['HEAD', 'GET']);
  });

  test('HEAD timeout → GET timeout → inconclusive (botBlocked), never a pass', async () => {
    const { impl, calls } = makeFetch(['timeout', 'timeout']);
    const r = await probeUrl(impl, URL_UNDER_TEST, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.botBlocked).toBe(true);
      expect(r.reason).toBe('bot_blocked_timeout');
    }
    expect(calls).toHaveLength(2);
  });

  test('HEAD 403 → GET 200 → ok (bot-hostile HEAD rescued by GET)', async () => {
    const { impl } = makeFetch([{ status: 403 }, { status: 200 }]);
    const r = await probeUrl(impl, URL_UNDER_TEST, OPTS);
    expect(r.ok).toBe(true);
  });

  test('HEAD 429 → GET 200 → ok', async () => {
    const { impl } = makeFetch([{ status: 429 }, { status: 200 }]);
    const r = await probeUrl(impl, URL_UNDER_TEST, OPTS);
    expect(r.ok).toBe(true);
  });

  test('HEAD 405 (method not allowed) → GET 200 → ok', async () => {
    const { impl, calls } = makeFetch([{ status: 405 }, { status: 200 }]);
    const r = await probeUrl(impl, URL_UNDER_TEST, OPTS);
    expect(r.ok).toBe(true);
    expect(calls.map((c) => c.method)).toEqual(['HEAD', 'GET']);
  });

  test('HEAD 500 → genuine failure, NOT rescued, single request (real outage still detected)', async () => {
    const { impl, calls } = makeFetch([{ status: 500 }]);
    const r = await probeUrl(impl, URL_UNDER_TEST, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.botBlocked).toBe(false);
      expect(r.reason).toBe('head_http_500');
    }
    expect(calls).toHaveLength(1);
  });

  test('HEAD 403 → GET 403 → inconclusive (bot wall never yields)', async () => {
    const { impl } = makeFetch([{ status: 403 }, { status: 403 }]);
    const r = await probeUrl(impl, URL_UNDER_TEST, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.botBlocked).toBe(true);
      expect(r.reason).toBe('bot_blocked_http_403');
    }
  });

  test('HEAD 403 → GET 500 → GENUINE failure (a determinate error on GET is not a bot wall)', async () => {
    const { impl } = makeFetch([{ status: 403 }, { status: 500 }]);
    const r = await probeUrl(impl, URL_UNDER_TEST, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.botBlocked).toBe(false);
      expect(r.reason).toBe('get_http_500');
    }
  });

  test('HEAD network error (non-abort) → genuine failure, single request', async () => {
    const { impl, calls } = makeFetch([{ error: 'ECONNREFUSED' }]);
    const r = await probeUrl(impl, URL_UNDER_TEST, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.botBlocked).toBe(false);
      expect(r.reason).toMatch(/^error:/);
    }
    expect(calls).toHaveLength(1);
  });

  test('returns the final URL so the caller can assert the localised host', async () => {
    const { impl } = makeFetch([{ status: 200, url: 'https://www.johnlewis.com/home' }]);
    const r = await probeUrl(impl, URL_UNDER_TEST, OPTS);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.finalUrl).toBe('https://www.johnlewis.com/home');
  });
});

// ── BUGS-23: summariseResults treats bot-walled probes as inconclusive ───

function botBlockedOutcome(merchantId: string, country: string): ProbeOutcome {
  return {
    merchantId,
    buyerCountry: country,
    ok: false,
    finalUrl: null,
    failureReason: 'bot_blocked_timeout',
    botBlocked: true,
    durationMs: 5000,
  };
}

describe('BUGS-23 summariseResults — inconclusive (bot-walled) handling', () => {
  test('a merchant that is ONLY bot-walled is inconclusive, NOT fully-down, and does NOT alert', () => {
    const out = summariseResults([botBlockedOutcome('johnlewis', 'GB')]);
    expect(out.merchantsFullyDown).toEqual([]);
    expect(out.merchantsInconclusive).toEqual(['johnlewis']);
    expect(out.botBlocked).toBe(1);
    expect(out.failed).toBe(0);
    expect(out.failureRate).toBe(0);
    expect(out.shouldAlert).toBe(false);
  });

  test('a GENUINE johnlewis failure still pages (monitor not weakened)', () => {
    const out = summariseResults([failing('johnlewis', 'GB', 'head_http_503')]);
    expect(out.merchantsFullyDown).toEqual(['johnlewis']);
    expect(out.shouldAlert).toBe(true);
  });

  test('bot-walled probes are excluded from the failure rate denominator', () => {
    // 1 pass + 1 bot-walled → assessable = 1, genuine failures = 0 → rate 0.
    const out = summariseResults([passing('amazon', 'GB'), botBlockedOutcome('johnlewis', 'GB')]);
    expect(out.failureRate).toBe(0);
    expect(out.shouldAlert).toBe(false);
    expect(out.botBlocked).toBe(1);
  });

  test('a merchant with a pass AND a bot-wall is neither fully-down nor inconclusive', () => {
    const out = summariseResults([
      passing('bookshop_org', 'GB'),
      botBlockedOutcome('bookshop_org', 'US'),
    ]);
    expect(out.merchantsFullyDown).toEqual([]);
    expect(out.merchantsInconclusive).toEqual([]);
  });

  test('genuine failure + bot-wall on the SAME merchant → fully-down wins (pages)', () => {
    const out = summariseResults([
      failing('johnlewis', 'GB', 'head_http_500'),
      botBlockedOutcome('johnlewis', 'GB'),
    ]);
    expect(out.merchantsFullyDown).toEqual(['johnlewis']);
    expect(out.merchantsInconclusive).toEqual([]);
    expect(out.shouldAlert).toBe(true);
  });
});
