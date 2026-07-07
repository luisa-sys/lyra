'use server';

import { getInviteeByToken, recordRsvpResponse } from '@/lib/convene/invites/repository';
import { isConveneEnabled } from '@/lib/convene/flags';
import { sanitiseText } from '@/lib/sanitise';
import { checkModeration } from '@/lib/moderation-policy';

type Result = { ok: true } | { ok: false; error: string };

/**
 * SEC-53 (finding web-input-02) — this is the ONLY unauthenticated Convene
 * write: anyone holding an invite token can reach it and the DB write goes
 * through the RLS-bypassing service-role client. Every field is therefore
 * bounded and validated at runtime BEFORE it reaches the DB:
 *
 *   - `status` is checked against the allowed set. The TypeScript union is
 *     erased at runtime and a server action can be invoked with arbitrary
 *     args, so the DB CHECK must not be the sole backstop.
 *   - `note` is HTML-stripped + capped at 500 chars via `sanitiseText`
 *     (mirrors the ≤500 cap on POST /api/reports), then run through the
 *     standard moderation pipeline — it is surfaced to the host, so
 *     block-severity content (profanity / PII) is rejected, not stored.
 */
const RSVP_STATUSES = ['accepted', 'declined', 'tentative'] as const;
type RsvpStatus = (typeof RSVP_STATUSES)[number];

const NOTE_MAX = 500;

export async function submitRsvp(
  token: string,
  status: string,
  note?: string
): Promise<Result> {
  if (!isConveneEnabled()) return { ok: false, error: 'Convene is not enabled' };

  // Runtime status validation — the TS union above is erased at runtime.
  if (!RSVP_STATUSES.includes(status as RsvpStatus)) {
    return { ok: false, error: 'Invalid RSVP status' };
  }

  // Bound + sanitise the free-text note, then moderate the post-strip text
  // (so anything hidden inside stripped HTML is still caught) before it can
  // reach the service-role DB write.
  let cleanedNote: string | undefined;
  if (note != null) {
    const sanitised = sanitiseText(note, NOTE_MAX);
    if (sanitised) {
      const mod = checkModeration(sanitised, 'public', 'rsvp.note');
      if (!mod.ok) return { ok: false, error: mod.error };
      cleanedNote = sanitised;
    }
  }

  const invitee = await getInviteeByToken(token);
  if (!invitee) return { ok: false, error: 'Invalid or expired invitation link' };
  if (invitee.tokenExpiresAt && new Date(invitee.tokenExpiresAt) < new Date()) {
    return { ok: false, error: 'This invitation has expired' };
  }
  try {
    await recordRsvpResponse(invitee.inviteeId, status as RsvpStatus, cleanedNote);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to record response' };
  }
}
