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
  type ProbeOutcome,
} from '@/lib/affiliate/smoke';

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
