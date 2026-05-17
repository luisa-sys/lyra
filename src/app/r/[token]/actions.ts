'use server';

import { getInviteeByToken, recordRsvpResponse } from '@/lib/convene/invites/repository';
import { isConveneEnabled } from '@/lib/convene/flags';

type Result = { ok: true } | { ok: false; error: string };

export async function submitRsvp(
  token: string,
  status: 'accepted' | 'declined' | 'tentative',
  note?: string
): Promise<Result> {
  if (!isConveneEnabled()) return { ok: false, error: 'Convene is not enabled' };
  const invitee = await getInviteeByToken(token);
  if (!invitee) return { ok: false, error: 'Invalid or expired invitation link' };
  if (invitee.tokenExpiresAt && new Date(invitee.tokenExpiresAt) < new Date()) {
    return { ok: false, error: 'This invitation has expired' };
  }
  try {
    await recordRsvpResponse(invitee.inviteeId, status, note?.trim() || undefined);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to record response' };
  }
}
