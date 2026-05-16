/**
 * Google Calendar adapter (KAN-206).
 *
 * Implements the canonical CalendarAdapter interface against Google Calendar
 * REST API v3. Uses the existing src/lib/convene/google/* helpers (from the
 * P0 spike — promoted to first-class in P2).
 *
 * Tokens come from src/lib/convene/oauth-connections.ts (Vault round-trip +
 * refresh-with-backoff). Event titles are sent to Google but NEVER persisted
 * on our side — only IDs and start/end times come back.
 *
 * createEvent/updateEvent/deleteEvent ship in P2 to keep the adapter complete
 * but aren't called from any user-facing flow until P4 (gathering lifecycle).
 */

import type {
  CalendarAdapter,
  GatheringEventData,
  TimeWindow,
  BusyBlock,
} from './types';
import { getFreshAccessToken } from '../oauth-connections';

const BASE = 'https://www.googleapis.com/calendar/v3';

async function googleFetch(
  accessToken: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

async function readErrorOrThrow(res: Response, op: string): Promise<never> {
  let detail = '';
  try {
    detail = await res.text();
  } catch {
    /* ignore */
  }
  const err = new Error(`Google ${op} failed (${res.status}): ${detail}`) as Error & {
    status: number;
    retryable: boolean;
  };
  err.status = res.status;
  err.retryable = res.status >= 500 || res.status === 429;
  throw err;
}

export const googleCalendarAdapter: CalendarAdapter = {
  async getFreeBusy(connectionId: string, window: TimeWindow): Promise<BusyBlock[]> {
    const { accessToken } = await getFreshAccessToken(connectionId);
    const res = await googleFetch(accessToken, 'POST', '/freeBusy', {
      timeMin: window.start.toISOString(),
      timeMax: window.end.toISOString(),
      items: [{ id: 'primary' }],
    });
    if (!res.ok) await readErrorOrThrow(res, 'freeBusy');
    const json = (await res.json()) as {
      calendars: Record<string, { busy: BusyBlock[] }>;
    };
    return json.calendars?.primary?.busy ?? [];
  },

  async createEvent(connectionId: string, data: GatheringEventData) {
    const { accessToken } = await getFreshAccessToken(connectionId);
    const res = await googleFetch(accessToken, 'POST', '/calendars/primary/events', {
      summary: data.title,
      description: data.description,
      location: data.location,
      start: { dateTime: data.startISO },
      end: { dateTime: data.endISO },
      attendees: data.attendees?.map((a) => ({
        email: a.email,
        displayName: a.displayName,
        optional: a.optional ?? false,
      })),
    });
    if (!res.ok) await readErrorOrThrow(res, 'createEvent');
    const json = (await res.json()) as { id: string };
    return { providerEventId: json.id };
  },

  async updateEvent(connectionId: string, providerEventId: string, data: GatheringEventData) {
    const { accessToken } = await getFreshAccessToken(connectionId);
    const res = await googleFetch(
      accessToken,
      'PATCH',
      `/calendars/primary/events/${encodeURIComponent(providerEventId)}`,
      {
        summary: data.title,
        description: data.description,
        location: data.location,
        start: { dateTime: data.startISO },
        end: { dateTime: data.endISO },
        attendees: data.attendees?.map((a) => ({
          email: a.email,
          displayName: a.displayName,
          optional: a.optional ?? false,
        })),
      }
    );
    if (!res.ok) await readErrorOrThrow(res, 'updateEvent');
  },

  async deleteEvent(connectionId: string, providerEventId: string) {
    const { accessToken } = await getFreshAccessToken(connectionId);
    const res = await googleFetch(
      accessToken,
      'DELETE',
      `/calendars/primary/events/${encodeURIComponent(providerEventId)}`
    );
    // 404/410 mean the event is already gone — idempotent success.
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      await readErrorOrThrow(res, 'deleteEvent');
    }
  },

  async revokeAtProvider(connectionId: string) {
    const { accessToken } = await getFreshAccessToken(connectionId);
    const res = await fetch(
      `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`,
      { method: 'POST' }
    );
    // Best-effort: don't throw — we still want to forget locally even if Google
    // says the token was already revoked.
    if (!res.ok && res.status !== 400) {
      console.warn(`[convene/google] revoke returned ${res.status}`);
    }
  },
};
