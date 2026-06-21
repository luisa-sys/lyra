/**
 * KAN-309 follow-on: the paid-gift-links gate inside getAffiliateLink.
 *
 * Security-critical: a recipient who is NOT entitled to paid links must get a
 * RAW url with monetised:false AND NO click logged (no attribution pollution).
 * An entitled recipient still logs raw clicks today (Sovrn unset) — existing
 * KAN-189 behaviour preserved.
 */

const mockInsert = jest.fn().mockResolvedValue({ error: null });

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({ insert: (...a: unknown[]) => mockInsert(...a) }),
  }),
}));

jest.mock('@/lib/env', () => ({
  env: {
    supabaseUrl: () => 'http://localhost',
    supabaseServiceRoleKey: () => 'service-key',
  },
}));

import { getAffiliateLink } from '@/lib/affiliate/link-service';

const BASE = {
  rawUrl: 'https://amazon.co.uk/dp/B07XYZ',
  buyerCountry: 'GB',
  recipientId: 'recipient-profile-1',
  source: 'web' as const,
};

describe('paid-gift-links gate (KAN-309)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SOVRN_API_KEY;
  });

  it('not entitled → raw url, monetised:false, and NO click logged', async () => {
    const r = await getAffiliateLink({ ...BASE, paidLinksEnabled: false });
    expect(r.monetised).toBe(false);
    expect(r.provider).toBe('raw');
    expect(r.url).toBe(BASE.rawUrl);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('entitled (Sovrn unset) → raw url but the click IS logged (KAN-189 preserved)', async () => {
    const r = await getAffiliateLink({ ...BASE, paidLinksEnabled: true });
    expect(r.monetised).toBe(false); // no SOVRN_API_KEY → raw
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });
});
