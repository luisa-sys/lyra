/**
 * KAN-206 — Google Calendar adapter unit tests.
 *
 * Uses jest module mocks to substitute the oauth-connections repository
 * (which would otherwise hit Supabase). Verifies the adapter constructs the
 * right HTTP calls and handles success + error paths.
 */

jest.mock('@/lib/convene/oauth-connections', () => ({
  getFreshAccessToken: jest.fn(),
}));

import { googleCalendarAdapter } from '@/lib/convene/calendar/google';
import { adapterFor } from '@/lib/convene/calendar';
import { getFreshAccessToken } from '@/lib/convene/oauth-connections';

const mockGetFresh = getFreshAccessToken as jest.MockedFunction<typeof getFreshAccessToken>;
const ORIGINAL_FETCH = global.fetch;

beforeEach(() => {
  mockGetFresh.mockReset();
  mockGetFresh.mockResolvedValue({ accessToken: 'AT-test', expiresAt: new Date(Date.now() + 3600_000) });
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

function mockJson(body: unknown, status = 200) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as unknown as typeof fetch;
}

describe('adapterFor', () => {
  it('returns googleCalendarAdapter for google', () => {
    expect(adapterFor('google')).toBe(googleCalendarAdapter);
  });

  it('throws for unknown provider', () => {
    expect(() => adapterFor('microsoft')).toThrow(/No calendar adapter/);
  });
});

describe('googleCalendarAdapter.getFreeBusy', () => {
  it('calls /freeBusy with bearer token and primary calendar', async () => {
    global.fetch = mockJson({ calendars: { primary: { busy: [{ start: 'S', end: 'E' }] } } });

    const out = await googleCalendarAdapter.getFreeBusy('conn-1', {
      start: new Date('2026-06-01T00:00:00Z'),
      end: new Date('2026-06-08T00:00:00Z'),
    });

    expect(mockGetFresh).toHaveBeenCalledWith('conn-1');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const call = (global.fetch as jest.Mock).mock.calls[0];
    expect(call[0]).toContain('/freeBusy');
    expect(call[1].method).toBe('POST');
    expect(call[1].headers.authorization).toBe('Bearer AT-test');
    const body = JSON.parse(call[1].body as string);
    expect(body.items).toEqual([{ id: 'primary' }]);
    expect(body.timeMin).toBe('2026-06-01T00:00:00.000Z');

    expect(out).toEqual([{ start: 'S', end: 'E' }]);
  });

  it('returns empty array when no busy blocks', async () => {
    global.fetch = mockJson({ calendars: { primary: { busy: [] } } });
    const out = await googleCalendarAdapter.getFreeBusy('conn-1', {
      start: new Date(),
      end: new Date(),
    });
    expect(out).toEqual([]);
  });

  it('throws with status code on Google error', async () => {
    global.fetch = mockJson({ error: 'forbidden' }, 403);
    await expect(
      googleCalendarAdapter.getFreeBusy('conn-1', { start: new Date(), end: new Date() })
    ).rejects.toThrow(/403/);
  });
});

describe('googleCalendarAdapter.createEvent', () => {
  it('POSTs to /calendars/primary/events with summary, times, attendees', async () => {
    global.fetch = mockJson({ id: 'EVENT-123' }, 200);

    const out = await googleCalendarAdapter.createEvent('conn-1', {
      title: 'Dinner',
      description: 'a meal',
      startISO: '2026-06-01T19:00:00Z',
      endISO: '2026-06-01T21:00:00Z',
      location: 'Somewhere',
      attendees: [{ email: 'a@b.com', displayName: 'A B', optional: false }],
    });

    expect(out).toEqual({ providerEventId: 'EVENT-123' });
    const call = (global.fetch as jest.Mock).mock.calls[0];
    expect(call[0]).toContain('/calendars/primary/events');
    expect(call[1].method).toBe('POST');
    const body = JSON.parse(call[1].body as string);
    expect(body.summary).toBe('Dinner');
    expect(body.location).toBe('Somewhere');
    expect(body.start).toEqual({ dateTime: '2026-06-01T19:00:00Z' });
    expect(body.attendees).toHaveLength(1);
    expect(body.attendees[0].email).toBe('a@b.com');
  });
});

describe('googleCalendarAdapter.deleteEvent', () => {
  it('treats 404 / 410 as success (idempotent)', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404, text: () => Promise.resolve('') });
    await expect(googleCalendarAdapter.deleteEvent('c', 'e')).resolves.toBeUndefined();
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 410, text: () => Promise.resolve('') });
    await expect(googleCalendarAdapter.deleteEvent('c', 'e')).resolves.toBeUndefined();
  });

  it('throws on 500', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('server error'),
    }) as unknown as typeof fetch;
    await expect(googleCalendarAdapter.deleteEvent('c', 'e')).rejects.toThrow(/500/);
  });

  it('URL-encodes the providerEventId', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204 }) as unknown as typeof fetch;
    await googleCalendarAdapter.deleteEvent('c', 'a/b c');
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain('a%2Fb%20c');
  });
});

describe('googleCalendarAdapter.revokeAtProvider', () => {
  it('best-effort: does not throw on 400 (already revoked)', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400 }) as unknown as typeof fetch;
    await expect(googleCalendarAdapter.revokeAtProvider('c')).resolves.toBeUndefined();
  });
});
