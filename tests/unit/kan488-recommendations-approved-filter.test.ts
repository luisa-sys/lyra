/**
 * KAN-488 — the unauthenticated recommendation APIs never feed an unapproved
 * AI gift suggestion into their output (spec v0.8 §3: "Public profile must
 * not expose … unapproved AI content in APIs").
 *
 * Behavioural: each route's real GET runs against the per-statement Supabase
 * mock, whose fixture rows are filtered by the statement's own `.eq()` calls.
 * The recommender is stubbed only to capture the items the route hands it,
 * so a dropped `approved` filter puts the secret row into that input.
 *
 * KAN-488 review (Major 1): even with approved inputs, the OUTPUT is a list of
 * suggestions the member never approved, so both routes are now gated OFF
 * unless LYRA_PUBLIC_RECOMMENDATIONS_API=1. The gate-off cases assert a 404
 * with no database read at all; the filter cases run with the gate on.
 */

const mockRows: Record<string, Array<Record<string, unknown>>> = {
  public_profiles: [
    {
      id: 'p-alice',
      slug: 'alice',
      display_name: 'Alice Example',
      bio_short: null,
      headline: null,
      is_published: true,
      delivery_country_code: 'FR',
    },
  ],
  profile_items: [
    { profile_id: 'p-alice', category: 'gift_ideas', title: 'Pottery class', description: null, visibility: 'public', approved: true },
    { profile_id: 'p-alice', category: 'gift_ideas', title: 'SECRET-AI-GIFT', description: null, visibility: 'public', approved: false },
  ],
};

jest.mock('@/modules/platform/supabase-service', () => {
  const harness = require('../support/supabase-statement-mock');
  return {
    createServiceRoleClient: () =>
      harness.createStatementMockClient({ getUserId: () => null, rows: (t: string) => mockRows[t] }),
  };
});

const mockGetRecommendations = jest.fn<unknown[], unknown[]>(() => []);
jest.mock('@/modules/recommendations/recommend', () => ({
  getRecommendations: (...args: unknown[]) => mockGetRecommendations(...args),
  getProfileInsights: () => ({}),
}));
jest.mock('@/modules/recommendations/recommender/v2/pipeline', () => ({
  buildV2Recommendations: async () => ({ recommendations: [], fellBackToEvergreen: false }),
}));

import { statementLog, onlyStatement } from '../support/supabase-statement-mock';
import { GET as getV1 } from '@/app/api/recommendations/[slug]/route';
import { GET as getV2 } from '@/app/api/recommendations/v2/[slug]/route';

const ORIGINAL_FLAG = process.env.LYRA_PUBLIC_RECOMMENDATIONS_API;

beforeEach(() => {
  statementLog.reset();
  mockGetRecommendations.mockClear();
  process.env.LYRA_PUBLIC_RECOMMENDATIONS_API = '1';
});

afterAll(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.LYRA_PUBLIC_RECOMMENDATIONS_API;
  else process.env.LYRA_PUBLIC_RECOMMENDATIONS_API = ORIGINAL_FLAG;
});

const ctx = { params: Promise.resolve({ slug: 'alice' }) };

describe.each([
  ['v1 /api/recommendations/[slug]', getV1, 'https://checklyra.com/api/recommendations/alice'],
  ['v2 /api/recommendations/v2/[slug]', getV2, 'https://checklyra.com/api/recommendations/v2/alice'],
])('KAN-488 %s', (_name, GET, url) => {
  test('the profile_items read carries approved = true', async () => {
    const res = await GET(new Request(url), ctx);
    expect(res.status).toBe(200);
    expect(onlyStatement('profile_items', 'select').eq).toContainEqual(['approved', true]);
  });

  test('the recommender is given the approved item only', async () => {
    await GET(new Request(url), ctx);
    expect(mockGetRecommendations).toHaveBeenCalledTimes(1);
    const input = mockGetRecommendations.mock.calls[0][0] as { items: Array<{ title: string }> };
    expect(input.items.map((i) => i.title)).toEqual(['Pottery class']);
  });

  test('gate unset: 404 not_found, and no database statement is issued', async () => {
    delete process.env.LYRA_PUBLIC_RECOMMENDATIONS_API;
    const res = await GET(new Request(url), ctx);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(statementLog.all).toHaveLength(0);
    expect(mockGetRecommendations).not.toHaveBeenCalled();
  });

  test('gate set to anything but exactly "1" stays closed', async () => {
    process.env.LYRA_PUBLIC_RECOMMENDATIONS_API = 'true';
    const res = await GET(new Request(url), ctx);
    expect(res.status).toBe(404);
    expect(statementLog.all).toHaveLength(0);
  });
});

describe('KAN-488 v2 response never echoes the hidden delivery country', () => {
  test('no recipientCountry key and no "FR" anywhere in the body', async () => {
    const res = await getV2(
      new Request('https://checklyra.com/api/recommendations/v2/alice?buyer_country=GB'),
      ctx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body)).not.toContain('recipientCountry');
    expect(body.buyerCountry).toBe('GB');
    expect(JSON.stringify(body)).not.toContain('"FR"');
  });
});
