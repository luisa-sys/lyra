/**
 * Minimal ICS (iCalendar) builder for Convene invites — KAN-209 (Phase 5).
 *
 * Produces RFC 5545-compliant VCALENDAR content as a single string, suitable
 * for attachment to invite emails. Apple Mail, Google Calendar, and Outlook
 * all parse this format. We use METHOD:REQUEST so the recipient sees a
 * "respond with Accept/Decline" prompt in their calendar app.
 *
 * Intentionally minimal: no recurrence rules, no timezones (UTC only — we
 * always store finalised slot times in UTC anyway), no attachments-in-event.
 */

interface ICSEventInput {
  uid: string; // stable per-gathering id, e.g. `gathering-<uuid>@checklyra.com`
  title: string;
  description?: string;
  location?: string;
  startISO: string; // UTC ISO 8601
  endISO: string; // UTC ISO 8601
  organizerEmail: string;
  organizerName?: string;
  attendeeEmail: string;
  attendeeName?: string;
}

function escapeICS(s: string): string {
  // RFC 5545 escapes: \ → \\, ; → \;, , → \, newlines → \n
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function toICSDate(iso: string): string {
  // YYYYMMDDTHHMMSSZ
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function fold(line: string): string {
  // RFC 5545 line folding at 75 octets. Keep simple: fold by character count.
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let pos = 0;
  while (pos < line.length) {
    parts.push(line.slice(pos, pos + 73));
    pos += 73;
  }
  return parts.join('\r\n ');
}

export function buildICS(input: ICSEventInput): string {
  const dtstamp = toICSDate(new Date().toISOString());
  const dtstart = toICSDate(input.startISO);
  const dtend = toICSDate(input.endISO);

  const organizer = input.organizerName
    ? `ORGANIZER;CN="${input.organizerName}":mailto:${input.organizerEmail}`
    : `ORGANIZER:mailto:${input.organizerEmail}`;
  const attendee = input.attendeeName
    ? `ATTENDEE;CN="${input.attendeeName}";RSVP=TRUE:mailto:${input.attendeeEmail}`
    : `ATTENDEE;RSVP=TRUE:mailto:${input.attendeeEmail}`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lyra//Convene//EN',
    'METHOD:REQUEST',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${input.uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SUMMARY:${escapeICS(input.title)}`,
    input.description ? `DESCRIPTION:${escapeICS(input.description)}` : null,
    input.location ? `LOCATION:${escapeICS(input.location)}` : null,
    organizer,
    attendee,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter((l): l is string => l !== null)
    .map(fold);

  return lines.join('\r\n');
}
