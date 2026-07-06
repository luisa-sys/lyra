/**
 * SEC-76 (web-convene-5) — ICS ORGANIZER/ATTENDEE param injection is neutralised.
 *
 * buildICS interpolates organizer/attendee display names into DQUOTE-quoted
 * CN="..." params and emails into mailto: values. A double-quote or a CR/LF in
 * a user-supplied name/email would break out of the quoted param and let an
 * attacker smuggle extra iCalendar params or whole calendar properties into the
 * invite attachment. These tests pin that such characters are stripped while
 * ordinary names/emails are left untouched.
 *
 * Note: a semicolon/colon is SAFE inside a DQUOTE-quoted CN value (RFC 5545
 * §3.2 QSAFE-CHAR) — only DQUOTE and control chars can break out — so we strip
 * exactly those and deliberately leave `;`/`:` intact.
 */

import { buildICS } from '@/lib/convene/invites/ics';

const base = {
  uid: 'gathering-1@checklyra.com',
  title: 'Coffee',
  startISO: '2026-08-01T10:00:00.000Z',
  endISO: '2026-08-01T11:00:00.000Z',
  organizerEmail: 'luisa@example.com',
  attendeeEmail: 'ben@example.com',
};

// RFC 5545 line folding inserts `\r\n ` — unfold before analysing properties.
function unfold(ics: string): string[] {
  return ics.replace(/\r\n /g, '').split('\r\n');
}

describe('buildICS param escaping (SEC-76)', () => {
  test('clean names/emails are unchanged', () => {
    const ics = buildICS({ ...base, organizerName: 'Luisa', attendeeName: 'Ben' });
    expect(ics).toMatch(/ORGANIZER;CN="Luisa":mailto:luisa@example\.com/);
    expect(ics).toMatch(/ATTENDEE;CN="Ben";RSVP=TRUE:mailto:ben@example\.com/);
  });

  test('double-quote in a name cannot break out of the CN param', () => {
    const ics = buildICS({
      ...base,
      organizerName: 'Eve";X-EVIL=1;CN="Eve',
      attendeeName: 'Ben',
    });
    // Both stray double-quotes are stripped; the semicolons stay harmlessly
    // inside the (still single) quoted CN value.
    expect(ics).toContain('ORGANIZER;CN="Eve;X-EVIL=1;CN=Eve":mailto:luisa@example.com');
    // No un-terminated quote sequence survives anywhere.
    expect(ics).not.toContain('X-EVIL=1;CN="');
  });

  test('CRLF in a name cannot inject a new iCalendar property line', () => {
    const ics = buildICS({
      ...base,
      organizerName: 'Mallory\r\nATTENDEE;CN=Ghost:mailto:ghost@evil.test',
      attendeeName: 'Ben',
    });
    const lines = unfold(ics);
    const attendeeLines = lines.filter((l) => /^ATTENDEE[;:]/.test(l));
    const organizerLines = lines.filter((l) => /^ORGANIZER[;:]/.test(l));
    // Exactly one real ATTENDEE (Ben) and one ORGANIZER — the injected ATTENDEE
    // is flattened into the ORGANIZER value, never its own property line.
    expect(attendeeLines).toHaveLength(1);
    expect(attendeeLines[0]).toContain('mailto:ben@example.com');
    expect(organizerLines).toHaveLength(1);
  });

  test('CRLF in an email is stripped from the mailto value', () => {
    const ics = buildICS({
      ...base,
      organizerEmail: 'luisa@example.com\r\nX-INJECT:1',
      organizerName: 'Luisa',
      attendeeName: 'Ben',
    });
    const lines = unfold(ics);
    expect(lines.some((l) => /^X-INJECT:/.test(l))).toBe(false);
  });

  test('output remains a single well-formed VCALENDAR/VEVENT', () => {
    const ics = buildICS({
      ...base,
      organizerName: 'A"\r\nB',
      attendeeName: 'C"\r\nD',
    });
    expect((ics.match(/BEGIN:VCALENDAR/g) || []).length).toBe(1);
    expect((ics.match(/END:VCALENDAR/g) || []).length).toBe(1);
    expect((ics.match(/BEGIN:VEVENT/g) || []).length).toBe(1);
  });
});
