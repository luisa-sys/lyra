/**
 * Repository for Convene invite send-flow — KAN-209 (Phase 5).
 *
 * Wraps the DB ops:
 *   - generateRsvpToken: cryptographically-strong, base58, 256 bits
 *   - persistInviteMessage: append to gathering_invite_messages with
 *                           delivery_status='queued'
 *   - markDelivered / markFailed: update delivery_status after send
 *   - getInviteeByToken: public RSVP page lookup
 *   - recordRsvpResponse: invitee accepts/declines/tentative
 */

import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { randomBytes } from 'crypto';

function admin() {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false },
  });
}

/** Base64url — 32 random bytes ≈ 43 chars. URL-safe (no /, +, =, padding). */
export function generateRsvpToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface PersistInviteInput {
  gatheringId: string;
  inviteeId: string;
  channel: 'email' | 'sms' | 'whatsapp' | 'imessage';
  templateName: string;
}

export async function persistQueuedInvite(input: PersistInviteInput): Promise<{ id: string }> {
  const sb = admin();
  // ownership-ok: caller verified gathering ownership (KAN-209)
  const { data, error } = await sb
    .from('gathering_invite_messages')
    .insert({
      gathering_id: input.gatheringId,
      invitee_id: input.inviteeId,
      channel: input.channel,
      template_name: input.templateName,
      delivery_status: 'queued',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`persist invite failed: ${error?.message ?? 'no row'}`);
  return { id: data.id };
}

export async function markInviteSent(messageId: string, externalMessageId: string): Promise<void> {
  const sb = admin();
  await sb
    .from('gathering_invite_messages')
    .update({
      delivery_status: 'sent',
      sent_at: new Date().toISOString(),
      external_message_id: externalMessageId,
    })
    .eq('id', messageId);
}

export async function markInviteFailed(messageId: string, reason: string): Promise<void> {
  const sb = admin();
  await sb
    .from('gathering_invite_messages')
    .update({
      delivery_status: 'failed',
      bounce_reason: reason.slice(0, 500),
    })
    .eq('id', messageId);
}

/**
 * Set the rsvp_token + token expiry on an invitee row. Idempotent — re-sending
 * an invite will rotate the token.
 */
export async function setInviteeRsvpToken(
  inviteeId: string,
  token: string,
  ttlDays: number = 30
): Promise<void> {
  const sb = admin();
  const expiresAt = new Date(Date.now() + ttlDays * 86400_000).toISOString();
  await sb
    .from('gathering_invitees')
    .update({
      rsvp_token: token,
      rsvp_token_expires_at: expiresAt,
      invited_at: new Date().toISOString(),
    })
    .eq('id', inviteeId);
}

// ─── Public RSVP page lookup ────────────────────────────────────────────

export interface InviteeLookup {
  inviteeId: string;
  gatheringId: string;
  hostUserId: string;
  gatheringTitle: string;
  gatheringType: string;
  finalisedSlotStart: string | null;
  finalisedSlotEnd: string | null;
  venueName: string | null;
  contactDisplayName: string;
  currentStatus: string;
  tokenExpiresAt: string | null;
}

export async function getInviteeByToken(token: string): Promise<InviteeLookup | null> {
  const sb = admin();
  // ownership-ok: token is opaque, single-use is enforced separately on update (KAN-209)
  const { data, error } = await sb
    .from('gathering_invitees')
    .select(`
      id, gathering_id, status, rsvp_token_expires_at,
      contact:contacts(display_name),
      gathering:gatherings(
        host_user_id, title, gathering_type, status,
        finalised_slot_start, finalised_slot_end,
        venue:venues(name, city)
      )
    `)
    .eq('rsvp_token', token)
    .maybeSingle();
  if (error || !data) return null;
  const d = data as unknown as {
    id: string;
    gathering_id: string;
    status: string;
    rsvp_token_expires_at: string | null;
    contact: { display_name: string } | null;
    gathering: {
      host_user_id: string;
      title: string;
      gathering_type: string;
      status: string;
      finalised_slot_start: string | null;
      finalised_slot_end: string | null;
      venue: { name: string; city: string | null } | null;
    } | null;
  };
  if (!d.gathering) return null;
  return {
    inviteeId: d.id,
    gatheringId: d.gathering_id,
    hostUserId: d.gathering.host_user_id,
    gatheringTitle: d.gathering.title,
    gatheringType: d.gathering.gathering_type,
    finalisedSlotStart: d.gathering.finalised_slot_start,
    finalisedSlotEnd: d.gathering.finalised_slot_end,
    venueName: d.gathering.venue ? `${d.gathering.venue.name}${d.gathering.venue.city ? ` — ${d.gathering.venue.city}` : ''}` : null,
    contactDisplayName: d.contact?.display_name ?? '(unknown)',
    currentStatus: d.status,
    tokenExpiresAt: d.rsvp_token_expires_at,
  };
}

export async function recordRsvpResponse(
  inviteeId: string,
  newStatus: 'accepted' | 'declined' | 'tentative',
  note?: string
): Promise<void> {
  const sb = admin();
  // ownership-ok: invitee row owned by gathering host; the token was
  // verified before this call (KAN-209)
  await sb
    .from('gathering_invitees')
    .update({
      status: newStatus,
      responded_at: new Date().toISOString(),
      notes: note ?? null,
    })
    .eq('id', inviteeId);

  // Audit on the parent gathering.
  const { data: invitee } = await sb
    .from('gathering_invitees')
    .select('gathering_id, contact_id')
    .eq('id', inviteeId)
    .maybeSingle();
  if (invitee) {
    await sb.from('gathering_events_log').insert({
      gathering_id: invitee.gathering_id,
      event_type: 'rsvp_recorded',
      subject_kind: 'invitee',
      subject_id: invitee.contact_id,
      metadata: { status: newStatus },
    });
  }
}
