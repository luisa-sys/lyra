/**
 * Google Calendar — free/busy probe.
 *
 * SPIKE quality (KAN-204). Promoted to full adapter in P2 (KAN-206) under
 * src/lib/convene/calendar/google.ts implementing the canonical CalendarAdapter
 * interface.
 */

export interface BusyBlock {
  start: string; // ISO 8601
  end: string;
}

export async function getFreeBusy(
  accessToken: string,
  windowStart: Date,
  windowEnd: Date
): Promise<BusyBlock[]> {
  const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      timeMin: windowStart.toISOString(),
      timeMax: windowEnd.toISOString(),
      items: [{ id: 'primary' }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google freeBusy failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as {
    calendars: Record<string, { busy: BusyBlock[] }>;
  };

  return json.calendars.primary?.busy ?? [];
}
