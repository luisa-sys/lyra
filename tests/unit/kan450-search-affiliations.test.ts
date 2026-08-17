/**
 * KAN-450 — "Find someone" also matches schools and organisations.
 *
 * These tests drive the REAL page module through a stub Supabase client and
 * assert on the query chains it actually builds, rather than scanning the
 * source for strings. That distinction matters here: the privacy guarantee is
 * `show_on_profile = true`, and a source scan for it stays green when the
 * filter is deleted but the comment explaining it survives (BUGS-85 / SEC-100,
 * gotcha #29).
 */

import * as React from 'react';

// This repo has no jest transform options, so @swc/jest compiles JSX with the
// CLASSIC runtime and the page's JSX needs `React` in scope when it runs.
// Changing jest.config.js would alter how every existing suite executes, which
// the Test Integrity Policy puts behind sign-off — a global here is local.
(globalThis as typeof globalThis & { React?: unknown }).React = React;

type Chain = {
  table: string;
  eq: Record<string, unknown>;
  in: Record<string, unknown[]>;
  ilike: Record<string, string>;
  or: string | null;
  order: string[];
  limit: number | null;
};

const mockChains: Chain[] = [];
let mockAffiliationRows: { profile_id: string }[] = [];
let mockProfileRows: (chain: Chain) => Record<string, unknown>[] = () => [];
/** Per-chain read error, so a failing read can be simulated on either table. */
let mockReadError: (chain: Chain) => unknown = () => null;

function mockMakeClient() {
  return {
    from(table: string) {
      const chain: Chain = { table, eq: {}, in: {}, ilike: {}, or: null, order: [], limit: null };
      mockChains.push(chain);
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          chain.eq[col] = val;
          return builder;
        },
        in: (col: string, vals: unknown[]) => {
          chain.in[col] = vals;
          return builder;
        },
        ilike: (col: string, val: string) => {
          chain.ilike[col] = val;
          return builder;
        },
        or: (expr: string) => {
          chain.or = expr;
          return builder;
        },
        order: (col: string) => {
          chain.order.push(col);
          return builder;
        },
        limit: (n: number) => {
          chain.limit = n;
          return builder;
        },
        then: (resolve: (value: { data: unknown[]; error: unknown }) => void) => {
          resolve({
            data: table === 'school_affiliations' ? mockAffiliationRows : mockProfileRows(chain),
            error: mockReadError(chain),
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

// The page reports failed reads to Sentry before throwing. Mock it so the unit
// test doesn't pull in Sentry's runtime (which needs network egress).
const mockCaptureException = jest.fn();
jest.mock('@sentry/nextjs', () => ({
  captureException: (...a: unknown[]) => mockCaptureException(...a),
}));

import SearchPage from '@/app/search/page';

function profileRow(id: string, displayName: string) {
  return {
    id,
    display_name: displayName,
    slug: id,
    headline: null,
    city: null,
    country: null,
    avatar_url: null,
  };
}

/** Names of every ProfileCard the page rendered, in render order. */
function renderedNames(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) renderedNames(child, out);
    return out;
  }
  if (node === null || typeof node !== 'object') return out;
  const props = (node as { props?: Record<string, unknown> }).props;
  if (!props) return out;
  const profile = props.profile as { display_name?: string } | undefined;
  if (profile && typeof profile.display_name === 'string') out.push(profile.display_name);
  if ('children' in props) renderedNames(props.children, out);
  return out;
}

async function search(q: string | undefined) {
  return renderedNames(await SearchPage({ searchParams: Promise.resolve({ q }) }));
}

const affiliationChain = () => mockChains.find((c) => c.table === 'school_affiliations');
// SEC-104: the profile reads target the `public_profiles` VIEW now, not the
// table. This selector is how every assertion below finds them, so it has to
// move first — pointing it at 'profiles' would silently yield ZERO chains and
// turn every expectation in this file into a vacuous pass.
const profileChains = () => mockChains.filter((c) => c.table === 'public_profiles');

beforeEach(() => {
  mockChains.length = 0;
  mockAffiliationRows = [];
  mockProfileRows = () => [];
  mockReadError = () => null;
  mockCaptureException.mockClear();
});

describe('KAN-450: hidden affiliations are never searchable', () => {
  test('the affiliation read filters show_on_profile = true', async () => {
    await search('oakfield');
    expect(affiliationChain()?.eq.show_on_profile).toBe(true);
  });

  test('the affiliation read is restricted to schools and organisations', async () => {
    await search('oakfield');
    expect(affiliationChain()?.in.affiliation_type).toEqual(['school', 'organisation']);
  });

  test('a hidden affiliation cannot reach the profiles read, because the filter is in the query', async () => {
    // The stub returns only what the filtered query would return. The assertion
    // that makes this meaningful is the one above: drop `show_on_profile` from
    // the page and it goes red.
    mockAffiliationRows = [{ profile_id: 'p-visible' }];
    mockProfileRows = (chain) =>
      chain.in.id ? [profileRow('p-visible', 'Visible Vera')] : [];

    expect(await search('oakfield')).toEqual(['Visible Vera']);
    expect(profileChains().find((c) => c.in.id)?.in.id).toEqual(['p-visible']);
  });
});

describe('KAN-450: the profiles reads keep every public-visibility guard', () => {
  test('both the name read and the affiliation read filter published, not suspended, not a demo', async () => {
    mockAffiliationRows = [{ profile_id: 'p-2' }];
    mockProfileRows = () => [];

    await search('oakfield');

    const chains = profileChains();
    expect(chains).toHaveLength(2);
    for (const chain of chains) {
      // SEC-104: `is_published`/`is_suspended` are no longer written at the
      // call site — they are in the view body, which binds service_role.
      // What must still be asserted per-branch is the source itself plus the
      // KAN-334 demo-profile exclusion, which is NOT part of the view.
      expect(chain.table).toBe('public_profiles');
      expect(chain.eq.is_published).toBeUndefined();
      expect(chain.eq.is_suspended).toBeUndefined();
      expect(chain.eq.is_homepage_example).toBe(false);
    }
  });

  test('the existing name / headline / city / slug match is unchanged', async () => {
    await search('oakfield');
    expect(profileChains()[0].or).toBe(
      'display_name.ilike.%oakfield%,headline.ilike.%oakfield%,city.ilike.%oakfield%,slug.ilike.%oakfield%',
    );
  });
});

describe('KAN-450: the two matches are unioned and de-duplicated', () => {
  test('a profile matched only by its school appears alongside name matches, once', async () => {
    mockAffiliationRows = [{ profile_id: 'p-both' }, { profile_id: 'p-school' }];
    mockProfileRows = (chain) =>
      chain.in.id
        ? [profileRow('p-school', 'Blake'), profileRow('p-both', 'Casey')]
        : [profileRow('p-both', 'Casey'), profileRow('p-name', 'Ada')];

    expect(await search('oakfield')).toEqual(['Ada', 'Blake', 'Casey']);
  });

  test('duplicate affiliation rows for one profile collapse to a single id', async () => {
    mockAffiliationRows = [
      { profile_id: 'p-1' },
      { profile_id: 'p-1' },
      { profile_id: 'p-2' },
    ];
    await search('oakfield');
    expect(profileChains().find((c) => c.in.id)?.in.id).toEqual(['p-1', 'p-2']);
  });

  test('no affiliation match means no second profiles read', async () => {
    mockAffiliationRows = [];
    await search('oakfield');
    expect(profileChains()).toHaveLength(1);
    expect(profileChains()[0].or).not.toBeNull();
  });
});

describe('KAN-450: bounds and sanitisation', () => {
  test('the affiliation id list is capped', async () => {
    await search('oakfield');
    expect(affiliationChain()?.limit).toBe(100);
  });

  test('both profiles reads stay capped at 30', async () => {
    mockAffiliationRows = [{ profile_id: 'p-1' }];
    await search('oakfield');
    for (const chain of profileChains()) expect(chain.limit).toBe(30);
  });

  test('the MERGED result is capped at 30, not 30 per branch', async () => {
    // Each branch may return a full page of 30, so without the final cap the
    // page renders up to 60 cards. Per-branch `.limit(30)` assertions above
    // stay green in that case — only the merged length catches it.
    const ids = (prefix: string) =>
      Array.from({ length: 30 }, (_, i) => `${prefix}-${String(i).padStart(2, '0')}`);

    mockAffiliationRows = ids('s').map((id) => ({ profile_id: id }));
    mockProfileRows = (chain) =>
      chain.in.id
        ? ids('s').map((id) => profileRow(id, `School ${id}`))
        : ids('n').map((id) => profileRow(id, `Name ${id}`));

    const names = await search('oakfield');
    expect(names).toHaveLength(30);
    expect(new Set(names).size).toBe(30);
  });

  test('an empty query reads nothing at all', async () => {
    expect(await search(undefined)).toEqual([]);
    expect(await search('   ')).toEqual([]);
    expect(mockChains).toHaveLength(0);
  });

  test('a query of only metacharacters is treated as empty, not as match-everything', async () => {
    expect(await search('%_(),')).toEqual([]);
    expect(mockChains).toHaveLength(0);
  });

  test('SEC-09 metacharacters are stripped before reaching the affiliation ilike', async () => {
    await search('oak%field,(x)');
    expect(affiliationChain()?.ilike.school_name).toBe('%oak field x%');
  });
});

describe('KAN-450: the affiliation cap truncates deterministically', () => {
  test('the capped affiliation read is ordered, so two identical searches agree', async () => {
    // A LIMIT with no ORDER BY lets Postgres return an arbitrary subset once
    // the cap binds — the same query, twice, can name different people.
    await search('oakfield');
    expect(affiliationChain()?.order).toEqual(['profile_id', 'id']);
  });
});

describe('KAN-450: a failed read is never rendered as an empty result', () => {
  test('a failed affiliation read throws instead of reporting "0 profiles found"', async () => {
    const boom = { message: 'column show_on_profile does not exist' };
    mockReadError = (chain) => (chain.table === 'school_affiliations' ? boom : null);

    await expect(search('oakfield')).rejects.toThrow(/school_affiliations/);
    expect(mockCaptureException).toHaveBeenCalledWith(
      boom,
      expect.objectContaining({ tags: expect.objectContaining({ read: 'school_affiliations' }) }),
    );
  });

  test('a failed profiles read throws instead of serving a partial union', async () => {
    const boom = { message: 'statement timeout' };
    mockAffiliationRows = [{ profile_id: 'p-1' }];
    mockReadError = (chain) => (chain.table === 'public_profiles' && chain.or ? boom : null);

    await expect(search('oakfield')).rejects.toThrow(/profiles:by-field/);
    expect(mockCaptureException).toHaveBeenCalledWith(boom, expect.anything());
  });

  test('a failed affiliation-branch profiles read throws too', async () => {
    const boom = { message: 'permission denied for table profiles' };
    mockAffiliationRows = [{ profile_id: 'p-1' }];
    mockReadError = (chain) => (chain.table === 'public_profiles' && chain.in.id ? boom : null);

    await expect(search('oakfield')).rejects.toThrow(/profiles:by-affiliation/);
    expect(mockCaptureException).toHaveBeenCalledWith(boom, expect.anything());
  });
});
