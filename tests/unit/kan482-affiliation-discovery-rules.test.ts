/**
 * KAN-482 — affiliation-based discovery: the binding rules in
 * docs/compliance/DPIA.md §2a (AD-1…AD-8), as they apply to the web
 * "Find someone" page.
 *
 * tests/unit/kan450-search-affiliations.test.ts already pins AD-1 (the
 * `show_on_profile = true` filter and the school/organisation type list),
 * AD-2 (the `public_profiles` view + homepage-example exclusion), AD-5
 * (sanitising, the 100 / 30 caps) and AD-8 (failed reads throw). This suite
 * adds the rules that were not pinned:
 *
 *   AD-3  results carry no affiliation fields — the affiliation read selects
 *         `profile_id` ONLY, and the profile read selects exactly the public
 *         card columns;
 *   AD-4  matching is on the affiliation NAME only (no location / postcode,
 *         relationship or description filter);
 *   AD-6  the page's own Sentry reports never carry the search term. (The
 *         other AD-6 routes — request URL, breadcrumbs, transactions and
 *         analytics — are pinned in sentry-scrub.test.ts,
 *         kan482-sentry-server-search-redaction.test.ts,
 *         sentry-client-init-behaviour.test.ts and
 *         kan482-analytics-search-redaction.test.tsx.)
 *
 * Like kan450, it drives the REAL page module through a stub Supabase client
 * and asserts on the query chains the page builds. Expected values are
 * literals (catalogue failure mode 10), and column lists are compared as SETS
 * so an extra column (over-fetching) goes red, not only a missing one.
 */

import * as React from 'react';

// Same reason as kan450: the classic JSX runtime needs React in scope.
(globalThis as typeof globalThis & { React?: unknown }).React = React;

type Chain = {
  table: string;
  select: string | null;
  eq: Record<string, unknown>;
  ilike: Record<string, string>;
  or: string | null;
};

const mockChains: Chain[] = [];
let mockAffiliationRows: { profile_id: string }[] = [];
let mockFail: (table: string) => unknown = () => null;

function mockMakeClient() {
  return {
    from(table: string) {
      const chain: Chain = { table, select: null, eq: {}, ilike: {}, or: null };
      mockChains.push(chain);
      const builder = {
        select: (cols: string) => {
          chain.select = cols;
          return builder;
        },
        eq: (col: string, val: unknown) => {
          chain.eq[col] = val;
          return builder;
        },
        in: () => builder,
        ilike: (col: string, val: string) => {
          chain.ilike[col] = val;
          return builder;
        },
        or: (expr: string) => {
          chain.or = expr;
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        then: (resolve: (value: { data: unknown[]; error: unknown }) => void) => {
          resolve({
            data: table === 'school_affiliations' ? mockAffiliationRows : [],
            error: mockFail(table),
          });
        },
      };
      return builder;
    },
  };
}

jest.mock('@/modules/platform/supabase-service', () => ({
  createServiceRoleClient: () => mockMakeClient(),
}));

const mockCaptureException = jest.fn();
jest.mock('@sentry/nextjs', () => ({
  captureException: (...a: unknown[]) => mockCaptureException(...a),
}));

import SearchPage from '@/app/search/page';

async function search(q: string) {
  return SearchPage({ searchParams: Promise.resolve({ q }) });
}

const columns = (select: string | null) =>
  new Set((select ?? '').split(',').map((c) => c.trim()).filter((c) => c !== ''));

beforeEach(() => {
  mockChains.length = 0;
  mockAffiliationRows = [];
  mockFail = () => null;
  mockCaptureException.mockClear();
});

describe('AD-3: no affiliation fields can reach a search result', () => {
  test('the affiliation read selects profile_id and nothing else', async () => {
    await search('oakfield');
    const aff = mockChains.filter((c) => c.table === 'school_affiliations');
    expect(aff).toHaveLength(1);
    expect(columns(aff[0].select)).toEqual(new Set(['profile_id']));
  });

  test('both profile reads select exactly the public card columns', async () => {
    mockAffiliationRows = [{ profile_id: 'p-1' }];
    await search('oakfield');
    const reads = mockChains.filter((c) => c.table === 'public_profiles');
    expect(reads).toHaveLength(2); // name branch + affiliation branch
    for (const r of reads) {
      expect(columns(r.select)).toEqual(
        new Set(['id', 'display_name', 'slug', 'headline', 'city', 'country', 'avatar_url']),
      );
    }
  });
});

describe('AD-4: affiliations are matched on the name only', () => {
  test('the only text filter on the affiliation read is school_name', async () => {
    await search('rh10');
    const aff = mockChains.find((c) => c.table === 'school_affiliations');
    expect(Object.keys(aff?.ilike ?? {})).toEqual(['school_name']);
    expect(aff?.or).toBeNull();
    expect(aff?.ilike.school_name).toBe('%rh10%');
  });
});

describe('AD-6: the search term never reaches error monitoring', () => {
  test.each(['school_affiliations', 'public_profiles'])(
    'a failed %s read is reported without the term',
    async (failing) => {
      mockAffiliationRows = [{ profile_id: 'p-1' }];
      mockFail = (table) => (table === failing ? { message: 'boom', code: 'XX000' } : null);
      const term = 'Zebedee Primary Uniquename';
      await expect(search(term)).rejects.toThrow();
      expect(mockCaptureException).toHaveBeenCalled();
      const reported = JSON.stringify(mockCaptureException.mock.calls).toLowerCase();
      expect(reported).not.toContain('zebedee');
      expect(reported).not.toContain('uniquename');
      // Positive control: the report really was serialised (the tag is in it).
      expect(reported).toContain('public-search');
    },
  );
});
