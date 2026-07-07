/**
 * SEC-53 (finding web-input-02) — submitRsvp input validation.
 *
 * submitRsvp is the only UNAUTHENTICATED Convene write (reachable by anyone
 * holding an invite token, writing via the service-role client). These tests
 * lock the three defences added under SEC-53:
 *   1. `status` is runtime-validated against the allowed set (TS union is
 *      erased at runtime; a bogus status must never reach the DB write).
 *   2. `note` is HTML-stripped + capped at 500 chars before storage.
 *   3. `note` is run through the moderation pipeline; block-severity content
 *      (e.g. PII / profanity on a host-facing field) is rejected, not stored.
 *
 * The repository + flag modules are mocked; sanitise + moderation run for real.
 */

// ── Mutable mock state ──────────────────────────────────────
let conveneEnabled = true;
let inviteeResult: {
  inviteeId: string;
  tokenExpiresAt: string | null;
} | null = { inviteeId: 'inv-1', tokenExpiresAt: null };

const recordCalls: Array<{ inviteeId: string; status: string; note: string | undefined }> = [];

jest.mock('@/lib/convene/flags', () => ({
  isConveneEnabled: () => conveneEnabled,
}));

jest.mock('@/lib/convene/invites/repository', () => ({
  getInviteeByToken: async () => inviteeResult,
  recordRsvpResponse: async (inviteeId: string, status: string, note: string | undefined) => {
    recordCalls.push({ inviteeId, status, note });
  },
}));

import { submitRsvp } from '@/app/r/[token]/actions';

beforeEach(() => {
  conveneEnabled = true;
  inviteeResult = { inviteeId: 'inv-1', tokenExpiresAt: null };
  recordCalls.length = 0;
});

describe('submitRsvp — status runtime validation (SEC-53)', () => {
  test('accepts each allowed status and writes it', async () => {
    for (const status of ['accepted', 'declined', 'tentative']) {
      recordCalls.length = 0;
      const res = await submitRsvp('tok', status, undefined);
      expect(res).toEqual({ ok: true });
      expect(recordCalls).toHaveLength(1);
      expect(recordCalls[0].status).toBe(status);
    }
  });

  test('rejects a status outside the allowed set and never touches the DB', async () => {
    const res = await submitRsvp('tok', 'going', 'hi');
    expect(res).toEqual({ ok: false, error: 'Invalid RSVP status' });
    expect(recordCalls).toHaveLength(0);
  });

  test('rejects an empty/garbage status before any DB write', async () => {
    for (const bogus of ['', 'ACCEPTED', 'maybe', 'accepted; drop table']) {
      recordCalls.length = 0;
      const res = await submitRsvp('tok', bogus, undefined);
      expect(res).toEqual({ ok: false, error: 'Invalid RSVP status' });
      expect(recordCalls).toHaveLength(0);
    }
  });
});

describe('submitRsvp — note length cap + sanitisation (SEC-53)', () => {
  test('caps an oversized note at 500 chars before storage', async () => {
    const huge = 'x '.repeat(400); // 800 chars, no repeated-char/spam trigger
    const res = await submitRsvp('tok', 'accepted', huge);
    expect(res).toEqual({ ok: true });
    expect(recordCalls).toHaveLength(1);
    expect(recordCalls[0].note!.length).toBe(500);
  });

  test('strips HTML tags from the note', async () => {
    const res = await submitRsvp('tok', 'accepted', '<b>Hello</b> <i>there</i>');
    expect(res).toEqual({ ok: true });
    expect(recordCalls[0].note).toBe('Hello there');
    expect(recordCalls[0].note).not.toContain('<');
    expect(recordCalls[0].note).not.toContain('>');
  });

  test('a whitespace-only note is stored as undefined, not an empty string', async () => {
    const res = await submitRsvp('tok', 'accepted', '   \n\t  ');
    expect(res).toEqual({ ok: true });
    expect(recordCalls).toHaveLength(1);
    expect(recordCalls[0].note).toBeUndefined();
  });

  test('omitted note records undefined', async () => {
    const res = await submitRsvp('tok', 'declined');
    expect(res).toEqual({ ok: true });
    expect(recordCalls[0].note).toBeUndefined();
  });

  test('a clean note passes through intact', async () => {
    const res = await submitRsvp('tok', 'tentative', 'See you there!');
    expect(res).toEqual({ ok: true });
    expect(recordCalls[0].note).toBe('See you there!');
  });
});

describe('submitRsvp — moderation pipeline (SEC-53)', () => {
  test('rejects a note containing PII (email) and never touches the DB', async () => {
    const res = await submitRsvp('tok', 'accepted', 'reach me at attacker@evil.com');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Content rejected/i);
    expect(recordCalls).toHaveLength(0);
  });

  test('rejects a note containing a phone number and never touches the DB', async () => {
    const res = await submitRsvp('tok', 'accepted', 'call +44 7911 123456 when you arrive');
    expect(res.ok).toBe(false);
    expect(recordCalls).toHaveLength(0);
  });
});

describe('submitRsvp — existing gates still hold (SEC-53 no regression)', () => {
  test('returns error when Convene is disabled, before validating anything', async () => {
    conveneEnabled = false;
    const res = await submitRsvp('tok', 'going' /* invalid, but flag gate wins */, 'hi');
    expect(res).toEqual({ ok: false, error: 'Convene is not enabled' });
    expect(recordCalls).toHaveLength(0);
  });

  test('returns error for an invalid/expired token (no invitee)', async () => {
    inviteeResult = null;
    const res = await submitRsvp('bad-tok', 'accepted', 'hi');
    expect(res).toEqual({ ok: false, error: 'Invalid or expired invitation link' });
    expect(recordCalls).toHaveLength(0);
  });

  test('returns error for an expired token window', async () => {
    inviteeResult = { inviteeId: 'inv-1', tokenExpiresAt: '2020-01-01T00:00:00Z' };
    const res = await submitRsvp('tok', 'accepted', 'hi');
    expect(res).toEqual({ ok: false, error: 'This invitation has expired' });
    expect(recordCalls).toHaveLength(0);
  });
});
