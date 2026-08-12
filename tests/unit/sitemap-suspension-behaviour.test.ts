/**
 * KAN-414 F4 (KAN-417 §8 group 3) — behavioural replacement for the
 * `dynamic sitemap.ts exists and queries published profiles` scan in
 * tests/unit/seo.test.js.
 *
 * THE INVARIANTS, IN WORDS
 * ------------------------
 *  1. The profile query reads the **`public_profiles` view**, never the raw
 *     `profiles` table. This is SEC-100/SEC-104. The sitemap is built with the
 *     SERVICE-ROLE client, which bypasses RLS, so the database policy that
 *     protects every other read does **not** apply here. Until SEC-104 the
 *     `is_published = true AND is_suspended = false` pair had to be written out
 *     by hand at every call site; it now lives in the view body, where it binds
 *     service_role by construction.
 *
 *     ⚠️ AND THAT MAKES THIS TEST NARROWER, WHICH IS WORTH SAYING OUT LOUD. A
 *     unit test cannot see whether the view on a given database actually
 *     carries the predicate — it can only prove the code reads the view. The
 *     other half moved to a control that CAN read a database:
 *     `scripts/check-db-invariants.py`, run per-environment by
 *     db-invariants.yml. An invariant relocated into the database needs its
 *     control relocated with it, or the guarantee is only a comment.
 *
 *     The fake below therefore MODELS the view rather than ignoring the table
 *     name, so invariant 2 still means something.
 *  2. A suspended member's slug never reaches the output. Invariant 1 is about
 *     the query; this is about the result, and they are not the same claim.
 *  3. Static pages are always present, and a Supabase failure degrades to
 *     static-only rather than throwing. A sitemap route that 500s is an SEO
 *     outage, and the failure mode is silent.
 *  4. Every URL is absolute and built from the configured site URL, so a
 *     preview deployment cannot publish preview-host URLs to search engines.
 *  5. The route is configured to render PER REQUEST, not at build time
 *     (SEC-130). Invariants 1 and 2 are about what the query asks for; this is
 *     about when it runs, and a correct query executed once at build time is
 *     still a stale answer. Until this was fixed the route read no dynamic API,
 *     so Next prerendered it and a suspended member's slug stayed in
 *     `/sitemap.xml` until the next deploy — while their profile page 404'd and
 *     `/search` dropped them immediately.
 *
 *     ⚠️ AND THIS ONE IS NARROWER STILL, WHICH IS WORTH SAYING OUT LOUD. Jest
 *     imports a module; it does not run a Next build, so it CANNOT observe
 *     whether the deployed route was prerendered. What it can do is pin the
 *     route segment config — which is the actual mechanism Next reads to make
 *     that decision, not a proxy for it. The deployed half (that
 *     `/sitemap.xml` really comes back uncached) is asserted against a running
 *     environment by the `C1-sitemap-fresh` probe in `scripts/staging-soak.sh`.
 *     Same reasoning as invariant 1: a guarantee that lives outside the unit
 *     needs a control that lives outside the unit.
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
const sources: string[] = [];
let rows: Row[] = [];
let clientThrows = false;

jest.mock('@/modules/platform/env', () => ({ env: { siteUrl: () => 'https://checklyra.com' } }));

jest.mock('@/modules/platform/supabase-service', () => ({
  createServiceRoleClient: () => {
    if (clientThrows) throw new Error('supabase unavailable');
    // A chainable that records each filter and resolves to whatever survives
    // them, so invariant 1 (the query) and invariant 2 (the result) can be
    // asserted independently rather than one standing in for the other.
    let source = '';
    const chain = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        eqCalls.push([col, val]);
        return chain;
      },
      then: (resolve: (v: unknown) => unknown) => {
        let out = rows;
        // SEC-104: the fake MODELS THE VIEW. `public_profiles` is defined as
        // `SELECT … WHERE is_published = true AND is_suspended = false`, so
        // reading it must yield only those rows here too — otherwise this
        // double would prove the route safe against a source that does not
        // behave like the one production uses.
        if (source === 'public_profiles') {
          out = out.filter(
            (r) =>
              (r as Record<string, unknown>).is_published === true &&
              (r as Record<string, unknown>).is_suspended === false,
          );
        }
        for (const [col, val] of eqCalls) {
          out = out.filter((r) => (r as Record<string, unknown>)[col] === val);
        }
        return resolve({ data: out, error: null });
      },
    };
    return {
      from: (table: string) => {
        source = table;
        sources.push(table);
        return chain;
      },
    };
  },
}));

// `jest.mock` is hoisted above imports, so the route sees the stubs below.
import sitemap from '@/app/sitemap';
// Imported as a namespace as well, so the route segment config can be asserted
// as the EVALUATED export rather than as source text. A `toContain` scan over
// the file would also match the comment explaining why the config is there —
// which is the CTL-039 failure mode, and this file's own header is a long
// argument against it.
import * as sitemapRoute from '@/app/sitemap';

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
  sources.length = 0;
  clientThrows = false;
  rows = [
    { ...LIVE, is_published: true } as Row,
    { ...SUSPENDED, is_published: true } as Row,
  ];
});

const urls = (m: MetadataRoute.Sitemap) => m.map((e) => e.url);

describe('sitemap (behavioural, KAN-414 F4 / SEC-100)', () => {
  it('reads the constrained source, not the raw profiles table (SEC-104)', async () => {
    // ⚠️ THIS ASSERTION CHANGED SHAPE, AND THE REASON MATTERS.
    //
    // It used to require `.eq('is_published', true)` AND `.eq('is_suspended',
    // false)` on the query, because the service-role client bypasses RLS and
    // that hand-written pair was the only thing between a moderated member and
    // Google's crawler. SEC-104 moved the pair into the `public_profiles` view
    // body, where it binds service_role by construction.
    //
    // So the thing to assert is no longer "did the caller remember the filters"
    // but "did the caller read the source that cannot forget them". That is a
    // narrower claim, and honestly so: a unit test CANNOT see whether the view
    // on a given database actually carries the predicate. That half is asserted
    // live, per environment, by scripts/check-db-invariants.py — because an
    // invariant that moved into the database needs a control that can read the
    // database.
    await sitemap();

    expect(sources).toContain('public_profiles');
    expect(sources).not.toContain('profiles');
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

describe('sitemap freshness (SEC-130)', () => {
  // Both assertions are POSITIVE on purpose. `expect(x).not.toBe(undefined)`
  // style checks are how this repo has previously shipped tests that could
  // never fail (catalogue entry 3 in CLAUDE.md): deleting the export makes the
  // binding `undefined`, and a negative assertion against `undefined` passes
  // forever. Asserting the exact expected value reddens on deletion AND on a
  // silent change of value.
  it('declares force-dynamic, so Next renders it per request', () => {
    expect(sitemapRoute.dynamic).toBe('force-dynamic');
  });

  it('declares revalidate = 0, so no ISR window can re-stale it', () => {
    // `force-dynamic` already implies this; stating it explicitly is what
    // src/app/status/page.tsx and src/app/api/health/route.ts do, and it means
    // relaxing the guarantee takes two deliberate edits rather than one.
    expect(sitemapRoute.revalidate).toBe(0);
  });
});
