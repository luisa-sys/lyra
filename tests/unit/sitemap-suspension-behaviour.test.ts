/**
 * KAN-414 F4 (KAN-417 §8 group 3) — behavioural replacement for the
 * `dynamic sitemap.ts exists and queries published profiles` scan in
 * tests/unit/seo.test.js.
 *
 * THE INVARIANTS, IN WORDS
 * ------------------------
 *  1. The profile query filters on **both** `is_published = true` AND
 *     `is_suspended = false`. This is SEC-100. The sitemap is built with the
 *     SERVICE-ROLE client, which bypasses RLS, so the database policy that
 *     protects every other read does **not** apply here — the filter has to be
 *     written out by hand, and nothing else will catch it if it is dropped.
 *  2. A suspended member's slug never reaches the output. Invariant 1 is about
 *     the query; this is about the result, and they are not the same claim.
 *  3. Static pages are always present, and a Supabase failure degrades to
 *     static-only rather than throwing. A sitemap route that 500s is an SEO
 *     outage, and the failure mode is silent.
 *  4. Every URL is absolute and built from the configured site URL, so a
 *     preview deployment cannot publish preview-host URLs to search engines.
 *
 * WHY THIS IS STRONGER — AND THE HISTORY THAT PROVES IT
 * -----------------------------------------------------
 * The old scan is four `toContain` calls, the load-bearing one being
 * `expect(sitemap).toContain('is_published')`.
 *
 * **SEC-100 was live while that assertion was green.** Suspended — that is,
 * moderated or taken-down — members' slugs were being published to search
 * engines for crawling. `is_published` was in the file the whole time; the
 * missing filter was `is_suspended`. The scan asserted the presence of the
 * string that was never the problem, so it passed before the defect, during
 * the defect, and after the fix, without ever changing.
 *
 * That is the sharpest available argument for this whole exercise: the test
 * guarding a surface did not move when a real data-exposure defect appeared on
 * that surface.
 *
 * MUTATION PROOF (2026-08-01, each reverted)
 *   * drop `.eq('is_suspended', false)` — i.e. SEC-100 reintroduced verbatim
 *       -> cases 1 and 2 redden; the old scan stays GREEN
 *   * flip to `.eq('is_suspended', true)`   -> cases 1 and 2 redden
 *   * drop `.eq('is_published', true)`      -> case 1 reddens
 *   * make the service client throw          -> case 3 catches the regression
 */
import type { MetadataRoute } from 'next';

const BASE = 'https://checklyra.com';

type Row = { slug: string; updated_at: string; is_suspended?: boolean };
type EqCall = [string, unknown];

const eqCalls: EqCall[] = [];
let rows: Row[] = [];
let clientThrows = false;

jest.mock('@/lib/env', () => ({ env: { siteUrl: () => 'https://checklyra.com' } }));

jest.mock('@/lib/supabase-service', () => ({
  createServiceRoleClient: () => {
    if (clientThrows) throw new Error('supabase unavailable');
    // A chainable that records each filter and resolves to whatever survives
    // them, so invariant 1 (the query) and invariant 2 (the result) can be
    // asserted independently rather than one standing in for the other.
    const chain = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        eqCalls.push([col, val]);
        return chain;
      },
      then: (resolve: (v: unknown) => unknown) => {
        let out = rows;
        for (const [col, val] of eqCalls) {
          out = out.filter((r) => (r as Record<string, unknown>)[col] === val);
        }
        return resolve({ data: out, error: null });
      },
    };
    return { from: () => chain };
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sitemap = require('@/app/sitemap').default as () => Promise<MetadataRoute.Sitemap>;

const LIVE: Row = {
  slug: 'ada',
  updated_at: '2026-01-01T00:00:00.000Z',
  is_suspended: false,
};
const SUSPENDED: Row = {
  slug: 'moderated-member',
  updated_at: '2026-01-01T00:00:00.000Z',
  is_suspended: true,
};

beforeEach(() => {
  eqCalls.length = 0;
  clientThrows = false;
  rows = [
    { ...LIVE, is_published: true } as Row,
    { ...SUSPENDED, is_published: true } as Row,
  ];
});

const urls = (m: MetadataRoute.Sitemap) => m.map((e) => e.url);

describe('sitemap (behavioural, KAN-414 F4 / SEC-100)', () => {
  it('filters on BOTH is_published and is_suspended', async () => {
    await sitemap();

    // The service-role client bypasses RLS, so this pair is the only thing
    // standing between a moderated member and Google's crawler.
    expect(eqCalls).toContainEqual(['is_published', true]);
    expect(eqCalls).toContainEqual(['is_suspended', false]);
  });

  it('never emits a suspended member’s slug (SEC-100)', async () => {
    const out = urls(await sitemap());

    expect(out).toContain(`${BASE}/ada`);
    // The defect itself, stated as an outcome rather than as a query shape.
    expect(out).not.toContain(`${BASE}/moderated-member`);
  });

  it('emits no profile URLs at all when every profile is suspended', async () => {
    rows = [{ ...SUSPENDED, is_published: true } as Row];

    const out = urls(await sitemap());

    expect(out.some((u) => u.includes('moderated-member'))).toBe(false);
  });

  it('degrades to static pages instead of throwing when Supabase is down', async () => {
    clientThrows = true;

    const out = urls(await sitemap());

    // A sitemap route that throws is an SEO outage, and a silent one.
    expect(out).toContain(BASE);
    expect(out).toContain(`${BASE}/privacy`);
    expect(out).toContain(`${BASE}/terms`);
    expect(out.some((u) => u.includes('ada'))).toBe(false);
  });

  it('emits only absolute URLs on the configured host', async () => {
    const out = urls(await sitemap());

    // Guards against a preview deployment publishing preview-host URLs.
    expect(out.length).toBeGreaterThan(0);
    for (const u of out) {
      expect(u.startsWith(`${BASE}`)).toBe(true);
      expect(() => new URL(u)).not.toThrow();
    }
  });

  it('gives every entry a changeFrequency and a priority', async () => {
    const entries = await sitemap();

    for (const e of entries) {
      expect(e.changeFrequency).toBeDefined();
      expect(typeof e.priority).toBe('number');
    }
  });
});
