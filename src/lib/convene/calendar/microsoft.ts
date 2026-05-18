/**
 * Microsoft Graph Calendar adapter — KAN-211 P7.
 *
 * Implements the canonical CalendarAdapter interface against Microsoft
 * Graph (calendar endpoints under /v1.0/me/calendar/*). Mirrors
 * google.ts in shape; provider-specific quirks (timezone marshalling,
 * dateTime envelope shape) are handled here.
 *
 * Tokens come from src/lib/convene/oauth-connections.ts (Vault round-trip
 * + provider-aware refresh). Event titles are sent to Microsoft but
 * NEVER persisted on our side — only IDs and start/end times come back.
 */

import type {
  CalendarAdapter,
  GatheringEventData,
  TimeWindow,
  BusyBlock,
} from './types';
import { getFreshAccessToken } from '../oauth-connections';

const BASE = 'https://graph.microsoft.com/v1.0';
const FETCH_TIMEOUT_MS = 8_000;

async function msFetch(
  accessToken: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

async function readErrorOrThrow(res: Response, op: string): Promise<never> {
  let detail = '';
  try {
    detail = await res.text();
  } catch {
    /* ignore */
  }
  const err = new Error(
    `Microsoft ${op} failed (${res.status}): ${detail.slice(0, 200)}`
  ) as Error & { status: number; retryable: boolean };
  err.status = res.status;
  err.retryable = res.status >= 500 || res.status === 429;
  throw err;
}

export const microsoftCalendarAdapter: CalendarAdapter = {
  async getFreeBusy(connectionId: string, window: TimeWindow): Promise<BusyBlock[]> {
    const { accessToken } = await getFreshAccessToken(connectionId);
    // Microsoft's /getSchedule expects ISO 8601 with TZ. Graph's responses
    // include both 'start' and 'end' as { dateTime, timeZone } objects.
    const res = await msFetch(accessToken, 'POST', '/me/calendar/getSchedule', {
      schedules: ['me'],
      startTime: { dateTime: window.start.toISOString(), timeZone: 'UTC' },
      endTime: { dateTime: window.end.toISOString(), timeZone: 'UTC' },
      availabilityViewInterval: 30,
    });
    if (!res.ok) await readErrorOrThrow(res, 'getSchedule');
    const json = (await res.json()) as {
      value?: Array<{
        scheduleItems?: Array<{
          status: string;
          start: { dateTime: string; timeZone: string };
          end: { dateTime: string; timeZone: string };
        }>;
      }>;
    };
    const items = json.value?.[0]?.scheduleItems ?? [];
    return items
      .filter((i) => i.status === 'busy' || i.status === 'oof' || i.status === 'tentative')
      .map((i) => ({
        start: normaliseToUtcISO(i.start.dateTime, i.start.timeZone),
        end: normaliseToUtcISO(i.end.dateTime, i.end.timeZone),
      }));
  },

  async createEvent(connectionId: string, data: GatheringEventData) {
    const { accessToken } = await getFreshAccessToken(connectionId);
    const res = await msFetch(accessToken, 'POST', '/me/events', {
      subject: data.title,
      body: data.description
        ? { contentType: 'text', content: data.description }
        : undefined,
      location: data.location ? { displayName: data.location } : undefined,
      start: { dateTime: data.startISO, timeZone: 'UTC' },
      end: { dateTime: data.endISO, timeZone: 'UTC' },
      attendees: data.attendees?.map((a) => ({
        emailAddress: { address: a.email, name: a.displayName ?? a.email },
        type: a.optional ? 'optional' : 'required',
      })),
    });
    if (!res.ok) await readErrorOrThrow(res, 'createEvent');
    const json = (await res.json()) as { id: string };
    return { providerEventId: json.id };
  },

  async updateEvent(connectionId: string, providerEventId: string, data: GatheringEventData) {
    const { accessToken } = await getFreshAccessToken(connectionId);
    const res = await msFetch(
      accessToken,
      'PATCH',
      `/me/events/${encodeURIComponent(providerEventId)}`,
      {
        subject: data.title,
        body: data.description
          ? { contentType: 'text', content: data.description }
          : undefined,
        location: data.location ? { displayName: data.location } : undefined,
        start: { dateTime: data.startISO, timeZone: 'UTC' },
        end: { dateTime: data.endISO, timeZone: 'UTC' },
        attendees: data.attendees?.map((a) => ({
          emailAddress: { address: a.email, name: a.displayName ?? a.email },
          type: a.optional ? 'optional' : 'required',
        })),
      }
    );
    if (!res.ok) await readErrorOrThrow(res, 'updateEvent');
  },

  async deleteEvent(connectionId: string, providerEventId: string) {
    const { accessToken } = await getFreshAccessToken(connectionId);
    const res = await msFetch(
      accessToken,
      'DELETE',
      `/me/events/${encodeURIComponent(providerEventId)}`
    );
    // 404/410 → already gone; idempotent success.
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      await readErrorOrThrow(res, 'deleteEvent');
    }
  },

  async revokeAtProvider() {
    // Microsoft Graph does not expose a direct token revoke endpoint
    // for delegated tokens — refresh tokens are invalidated when the
    // user removes the app from https://account.microsoft.com/privacy
    // or when the IT admin revokes via Azure AD. We surface this in
    // the disconnect copy on the dashboard.
  },
};

/**
 * Convert Microsoft Graph's { dateTime, timeZone } shape into a UTC ISO
 * string. Graph emits the local time in the named timezone; we treat the
 * local time as if it were UTC (a small lie) when the timeZone is 'UTC'
 * (which we always request). For freeBusy this is fine because we
 * explicitly send UTC bounds.
 */
function normaliseToUtcISO(dateTime: string, tz: string): string {
  if (tz === 'UTC') {
    // Graph returns 'YYYY-MM-DDTHH:mm:ss.SSSSSSS' without a Z suffix even
    // when timezone is UTC. Append Z to make it explicit + parseable.
    return dateTime.endsWith('Z') ? dateTime : `${dateTime}Z`;
  }
  // Fall back to Date parsing for non-UTC zones; less precise but
  // acceptable for busy-block detection.
  return new Date(`${dateTime}Z`).toISOString();
}
