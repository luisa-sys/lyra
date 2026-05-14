/**
 * KAN-153: unit tests for the discoverability server actions.
 *
 * Covers:
 *   - setDiscoverability flips flag ON and sets hash when given a value.
 *   - setDiscoverability flips flag OFF and clears the hash.
 *   - setDiscoverability rejects opt-in without a value.
 *   - setDiscoverability rejects an unnormalisable value WITHOUT echoing it
 *     back in the error message.
 *   - searchByPhone / searchByPostcode call the RPC with the right kind/hash.
 *   - search returns generic empty matches for unnormalisable input
 *     (no distinction between "bad input" and "unknown value").
 *   - Rate-limit kicks in after 10 calls per user per hour.
 *   - Plain phone/postcode values NEVER appear in any returned error.
 *
 * Supabase + next/cache are mocked. The pepper is set in beforeAll.
 */

// Set pepper before importing any module that calls getSearchPepper.
process.env.LYRA_SEARCH_PEPPER = 'unit-test-pepper-long-enough-for-validation';

// Mock next/cache.
const mockRevalidatePath = jest.fn();
jest.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

// Capture supabase interactions.
const mockUpdateCapture = jest.fn();
const mockUpdateEq = jest.fn().mockResolvedValue({ error: null });
const mockSelectEq = jest.fn();
const mockRpc = jest.fn();
let mockProfileRow: {
  id: string;
  discoverable_by_phone: boolean;
  discoverable_by_postcode: boolean;
} | null = {
  id: 'profile-1',
  discoverable_by_phone: false,
  discoverable_by_postcode: false,
};
let mockUserId: string | null = 'test-user-id';

jest.mock('@/lib/supabase-server', () => ({
  createClient: jest.fn(async () => ({
    auth: {
      getUser: jest.fn().mockImplementation(() =>
        Promise.resolve({
          data: { user: mockUserId ? { id: mockUserId } : null },
        })
      ),
    },
    from: jest.fn().mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve(
              mockProfileRow
                ? { data: mockProfileRow, error: null }
                : { data: null, error: { message: 'not found' } }
            ),
        }),
      }),
      update: (data: unknown) => {
        mockUpdateCapture(data);
        return { eq: mockUpdateEq };
      },
    })),
    rpc: (name: string, args: unknown) => mockRpc(name, args),
  })),
}));

// Mock the rate limiter so we can drive it deterministically.
const mockRateLimit = jest.fn();
jest.mock('@/lib/rate-limit', () => {
  const actual = jest.requireActual('@/lib/rate-limit');
  return {
    ...actual,
    rateLimit: (key: string, config: { limit: number; windowSeconds: number }) =>
      mockRateLimit(key, config),
  };
});

import {
  setDiscoverability,
  searchByPhone,
  searchByPostcode,
} from '@/app/dashboard/settings/discoverability-actions';

beforeEach(() => {
  mockUpdateCapture.mockClear();
  mockUpdateEq.mockClear();
  mockUpdateEq.mockResolvedValue({ error: null });
  mockSelectEq.mockClear();
  mockRpc.mockClear();
  mockRevalidatePath.mockClear();
  mockRateLimit.mockClear();
  mockRateLimit.mockReturnValue({ limited: false });
  mockProfileRow = {
    id: 'profile-1',
    discoverable_by_phone: false,
    discoverable_by_postcode: false,
  };
  mockUserId = 'test-user-id';
});

// ── setDiscoverability ─────────────────────────────────────
describe('setDiscoverability', () => {
  test('enabling phone with a valid value writes flag + hash', async () => {
    const result = await setDiscoverability({ phone: true, phoneValue: '07700900000' });
    expect(result).toEqual({ success: true });
    expect(mockUpdateCapture).toHaveBeenCalledTimes(1);
    const written = mockUpdateCapture.mock.calls[0][0] as Record<string, unknown>;
    expect(written.discoverable_by_phone).toBe(true);
    expect(typeof written.phone_search_hash).toBe('string');
    expect((written.phone_search_hash as string).length).toBe(64);
  });

  test('disabling phone clears the hash to null', async () => {
    mockProfileRow!.discoverable_by_phone = true;
    const result = await setDiscoverability({ phone: false });
    expect(result).toEqual({ success: true });
    const written = mockUpdateCapture.mock.calls[0][0] as Record<string, unknown>;
    expect(written.discoverable_by_phone).toBe(false);
    expect(written.phone_search_hash).toBeNull();
  });

  test('enabling postcode with a valid value writes flag + hash', async () => {
    const result = await setDiscoverability({ postcode: true, postcodeValue: 'SW1A 1AA' });
    expect(result).toEqual({ success: true });
    const written = mockUpdateCapture.mock.calls[0][0] as Record<string, unknown>;
    expect(written.discoverable_by_postcode).toBe(true);
    expect(typeof written.postcode_search_hash).toBe('string');
  });

  test('disabling postcode clears the hash to null', async () => {
    mockProfileRow!.discoverable_by_postcode = true;
    const result = await setDiscoverability({ postcode: false });
    expect(result).toEqual({ success: true });
    const written = mockUpdateCapture.mock.calls[0][0] as Record<string, unknown>;
    expect(written.discoverable_by_postcode).toBe(false);
    expect(written.postcode_search_hash).toBeNull();
  });

  test('rejects opting in to phone with no value', async () => {
    const result = await setDiscoverability({ phone: true });
    expect(result.success).toBe(false);
    expect(mockUpdateCapture).not.toHaveBeenCalled();
  });

  test('rejects opting in to postcode with no value', async () => {
    const result = await setDiscoverability({ postcode: true });
    expect(result.success).toBe(false);
    expect(mockUpdateCapture).not.toHaveBeenCalled();
  });

  test('rejects opting in with an unnormalisable phone — error does NOT echo the input', async () => {
    const badInput = 'this-is-not-a-phone-12345';
    const result = await setDiscoverability({ phone: true, phoneValue: badInput });
    expect(result.success).toBe(false);
    if (!result.success) {
      // Critical: the error message MUST NOT contain the user's input.
      expect(result.error).not.toContain(badInput);
    }
    expect(mockUpdateCapture).not.toHaveBeenCalled();
  });

  test('rejects opting in with an unnormalisable postcode — error does NOT echo the input', async () => {
    const badInput = 'NOT-A-VALID-POSTCODE!!';
    const result = await setDiscoverability({ postcode: true, postcodeValue: badInput });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).not.toContain(badInput);
    }
    expect(mockUpdateCapture).not.toHaveBeenCalled();
  });

  test('rejects unauthenticated callers', async () => {
    mockUserId = null;
    const result = await setDiscoverability({ phone: true, phoneValue: '07700900000' });
    expect(result.success).toBe(false);
    expect(mockUpdateCapture).not.toHaveBeenCalled();
  });

  test('empty input is a no-op success', async () => {
    const result = await setDiscoverability({});
    expect(result).toEqual({ success: true });
    expect(mockUpdateCapture).not.toHaveBeenCalled();
  });
});

// ── searchByPhone / searchByPostcode ───────────────────────
describe('searchByPhone / searchByPostcode', () => {
  test('searchByPhone calls the RPC with kind=phone and a hex hash', async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ id: 'p1', slug: 'alice' }], error: null });
    const result = await searchByPhone('07700900000');
    expect(result).toEqual({ success: true, matches: [{ id: 'p1', slug: 'alice' }] });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    const [name, args] = mockRpc.mock.calls[0];
    expect(name).toBe('search_by_contact_hash');
    expect((args as { p_kind: string }).p_kind).toBe('phone');
    expect((args as { p_hash: string }).p_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('searchByPostcode calls the RPC with kind=postcode and a hex hash', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    const result = await searchByPostcode('SW1A 1AA');
    expect(result).toEqual({ success: true, matches: [] });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    const [, args] = mockRpc.mock.calls[0];
    expect((args as { p_kind: string }).p_kind).toBe('postcode');
  });

  test('searchByPhone returns empty matches (NOT an error) for malformed input', async () => {
    // Indistinguishable response between "bad input" and "no match" —
    // we should not call the RPC at all in this case.
    const result = await searchByPhone('not a phone');
    expect(result).toEqual({ success: true, matches: [] });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('searchByPostcode returns empty matches (NOT an error) for malformed input', async () => {
    const result = await searchByPostcode('!!!');
    expect(result).toEqual({ success: true, matches: [] });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('searchByPhone surfaces a generic error on RPC failure — no hash leakage', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'pgrst something' } });
    const result = await searchByPhone('07700900000');
    expect(result.success).toBe(false);
    if (!result.success) {
      // The error must not contain the RPC's internal message OR the hash.
      expect(result.error).not.toContain('pgrst');
      expect(result.error).not.toMatch(/[a-f0-9]{32}/);
    }
  });

  test('searchByPhone rejects unauthenticated callers', async () => {
    mockUserId = null;
    const result = await searchByPhone('07700900000');
    expect(result.success).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('searchByPostcode rejects unauthenticated callers', async () => {
    mockUserId = null;
    const result = await searchByPostcode('SW1A 1AA');
    expect(result.success).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

// ── Rate-limit behaviour ───────────────────────────────────
describe('discoverability search rate-limit', () => {
  test('passes when rate limiter says allowed', async () => {
    mockRateLimit.mockReturnValue({ limited: false });
    mockRpc.mockResolvedValue({ data: [], error: null });
    const result = await searchByPhone('07700900000');
    expect(result.success).toBe(true);
    expect(mockRateLimit).toHaveBeenCalledTimes(1);
    const [key, config] = mockRateLimit.mock.calls[0];
    expect(key).toBe('discoverability-search:test-user-id');
    expect(config).toEqual({ limit: 10, windowSeconds: 3600 });
  });

  test('returns an error when rate limiter says limited', async () => {
    mockRateLimit.mockReturnValue({ limited: true, retryAfter: 123 });
    const result = await searchByPhone('07700900000');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/Too many/);
      expect(result.error).toContain('123');
    }
    // Critical: we must NOT have called the RPC when rate-limited.
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('per-user keyspace: different users get different rate-limit keys', async () => {
    mockRateLimit.mockReturnValue({ limited: false });
    mockRpc.mockResolvedValue({ data: [], error: null });

    mockUserId = 'user-a';
    await searchByPhone('07700900000');
    mockUserId = 'user-b';
    await searchByPhone('07700900000');

    const keys = mockRateLimit.mock.calls.map((c) => c[0]);
    expect(keys).toContain('discoverability-search:user-a');
    expect(keys).toContain('discoverability-search:user-b');
  });

  test('rate-limit applies to postcode search as well', async () => {
    mockRateLimit.mockReturnValue({ limited: true, retryAfter: 60 });
    const result = await searchByPostcode('SW1A 1AA');
    expect(result.success).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
