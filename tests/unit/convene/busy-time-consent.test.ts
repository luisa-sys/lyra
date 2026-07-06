/**
 * SEC-58 — WEB busy-time consent gate (defence-in-depth).
 *
 * Verifies that `assertBusyTimeConsent` mirrors the MCP SEC-18 gate
 * (profiles.share_availability_with_contacts) and that the calendar adapters
 * refuse to fetch another user's busy-times without the owner's consent —
 * failing CLOSED and never reaching the provider on a denial.
 */

// ── Mutable mock state for the profiles consent lookup ──────────────
let profileConsent: boolean | null | undefined = undefined;
let profileError: { message: string } | null = null;
let profileRowExists = true;
const maybeSingleCalls = { count: 0 };

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = async () => {
        maybeSingleCalls.count++;
        if (profileError) return { data: null, error: profileError };
        if (!profileRowExists) return { data: null, error: null };
        return { data: { share_availability_with_contacts: profileConsent }, error: null };
      };
      return chain;
    },
  })),
}));

jest.mock('@/lib/env', () => ({
  env: {
    supabaseUrl: () => 'http://supabase.test',
    supabaseServiceRoleKey: () => 'service-role-key',
  },
}));

jest.mock('@/lib/convene/oauth-connections', () => ({
  getFreshAccessToken: jest.fn(),
}));

import { assertBusyTimeConsent, BusyTimeConsentError } from '@/lib/convene/busy-time-consent';
import { googleCalendarAdapter } from '@/lib/convene/calendar/google';
import { microsoftCalendarAdapter } from '@/lib/convene/calendar/microsoft';
import { getFreshAccessToken } from '@/lib/convene/oauth-connections';

const mockGetFresh = getFreshAccessToken as jest.MockedFunction<typeof getFreshAccessToken>;
const ORIGINAL_FETCH = global.fetch;

const WINDOW = {
  start: new Date('2026-06-01T00:00:00Z'),
  end: new Date('2026-06-08T00:00:00Z'),
};

beforeEach(() => {
  profileConsent = undefined;
  profileError = null;
  profileRowExists = true;
  maybeSingleCalls.count = 0;
  mockGetFresh.mockReset();
  mockGetFresh.mockResolvedValue({
    accessToken: 'AT-test',
    expiresAt: new Date(Date.now() + 3600_000),
  });
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

function mockFetchJson(body: unknown, status = 200) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as unknown as typeof fetch;
}

describe('assertBusyTimeConsent', () => {
  it('allows reading your OWN calendar without a DB lookup', async () => {
    await expect(assertBusyTimeConsent('user-1', 'user-1')).resolves.toBeUndefined();
    expect(maybeSingleCalls.count).toBe(0);
  });

  it('allows a cross-user read when the target has consented', async () => {
    profileConsent = true;
    await expect(assertBusyTimeConsent('viewer', 'target')).resolves.toBeUndefined();
    expect(maybeSingleCalls.count).toBe(1);
  });

  it('refuses a cross-user read when the target has NOT consented (false)', async () => {
    profileConsent = false;
    await expect(assertBusyTimeConsent('viewer', 'target')).rejects.toBeInstanceOf(
      BusyTimeConsentError
    );
  });

  it('fails closed when consent is NULL (legacy default)', async () => {
    profileConsent = null;
    await expect(assertBusyTimeConsent('viewer', 'target')).rejects.toBeInstanceOf(
      BusyTimeConsentError
    );
  });

  it('fails closed when the target profile row is missing', async () => {
    profileRowExists = false;
    await expect(assertBusyTimeConsent('viewer', 'target')).rejects.toBeInstanceOf(
      BusyTimeConsentError
    );
  });

  it('fails closed on a query error (never discloses on unverifiable state)', async () => {
    profileError = { message: 'connection reset' };
    await expect(assertBusyTimeConsent('viewer', 'target')).rejects.toThrow(/connection reset/);
  });

  it('refuses when the target user id is empty', async () => {
    await expect(assertBusyTimeConsent('viewer', '')).rejects.toBeInstanceOf(
      BusyTimeConsentError
    );
    expect(maybeSingleCalls.count).toBe(0);
  });
});

describe('googleCalendarAdapter.getFreeBusy — SEC-58 gate', () => {
  it('refuses a cross-user fetch without consent and never calls the provider', async () => {
    profileConsent = false;
    global.fetch = jest.fn() as unknown as typeof fetch;

    await expect(
      googleCalendarAdapter.getFreeBusy('conn-1', WINDOW, {
        viewerUserId: 'A',
        ownerUserId: 'B',
      })
    ).rejects.toBeInstanceOf(BusyTimeConsentError);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockGetFresh).not.toHaveBeenCalled();
  });

  it('allows a cross-user fetch WITH consent and returns busy blocks', async () => {
    profileConsent = true;
    global.fetch = mockFetchJson({ calendars: { primary: { busy: [{ start: 'S', end: 'E' }] } } });

    const out = await googleCalendarAdapter.getFreeBusy('conn-1', WINDOW, {
      viewerUserId: 'A',
      ownerUserId: 'B',
    });

    expect(out).toEqual([{ start: 'S', end: 'E' }]);
    expect(mockGetFresh).toHaveBeenCalledWith('conn-1');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('reads own calendar (viewer === owner) without a consent DB lookup', async () => {
    global.fetch = mockFetchJson({ calendars: { primary: { busy: [] } } });

    await googleCalendarAdapter.getFreeBusy('conn-1', WINDOW, {
      viewerUserId: 'A',
      ownerUserId: 'A',
    });

    expect(maybeSingleCalls.count).toBe(0);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('stays backward-compatible when no viewer is supplied (no gate, no DB lookup)', async () => {
    global.fetch = mockFetchJson({ calendars: { primary: { busy: [] } } });

    await googleCalendarAdapter.getFreeBusy('conn-1', WINDOW);

    expect(maybeSingleCalls.count).toBe(0);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('microsoftCalendarAdapter.getFreeBusy — SEC-58 gate', () => {
  it('refuses a cross-user fetch without consent and never calls the provider', async () => {
    profileConsent = null;
    global.fetch = jest.fn() as unknown as typeof fetch;

    await expect(
      microsoftCalendarAdapter.getFreeBusy('conn-1', WINDOW, {
        viewerUserId: 'A',
        ownerUserId: 'B',
      })
    ).rejects.toBeInstanceOf(BusyTimeConsentError);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockGetFresh).not.toHaveBeenCalled();
  });
});
