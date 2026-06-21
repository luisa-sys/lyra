'use server';

/**
 * KAN-236 — server actions for the gathering detail page.
 *
 * - addToHostCalendar: uses the existing src/lib/convene/calendar/google.ts
 *   adapter to create a calendar event on the host's connected Google
 *   calendar. Records `calendar_event_added` in gathering_events_log on
 *   success.
 * - cancelGathering: transitions status to 'cancelled' via the state machine,
 *   appends gathering_cancelled to the audit log.
 *
 * All actions validate `host_user_id = auth.uid()` independent of RLS.
 */

import { createClient } from '@/lib/supabase-server';
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { applyTransition, type GatheringStatus } from '@/lib/convene/gatherings/state-machine';
import { adapterFor } from '@/lib/convene/calendar';
import { getConnectionForUser } from '@/lib/convene/oauth-connections';
import { generateRsvpToken, persistQueuedInvite, setInviteeRsvpToken } from '@/lib/convene/invites/repository';
import { dispatchQueuedInvites } from '@/lib/convene/invites/dispatch';

type Result = { ok: true } | { ok: false; error: string };
type SendSummary = { queued: number; sent: number; blocked_by_allowlist: number; failed: number };

function admin() {
  return createSupabaseAdmin(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false },
  });
}

async function authedUser(): Promise<{ userId: string } | { error: string }> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: 'Not signed in' };
  return { userId: user.id };
}

async function appendEvent(
  gatheringId: string,
  actorUserId: string,
  eventType: string,
  metadata: Record<string, unknown> = {}
) {
  const sb = admin();
  // ownership-ok: caller has already verified host_user_id matches (KAN-236)
  await sb.from('gathering_events_log').insert({
    gathering_id: gatheringId,
    actor_user_id: actorUserId,
    event_type: eventType,
    subject_kind: 'gathering',
    subject_id: gatheringId,
    metadata,
  });
}

export async function addToHostCalendar(gatheringId: string): Promise<Result> {
  const a = await authedUser();
  if ('error' in a) return { ok: false, error: a.error };
  const userId = a.userId;

  const sb = admin();
  // ownership-ok: explicit host_user_id filter (KAN-236)
  const { data: g, error: gErr } = await sb
    .from('gatherings')
    .select('id, title, description, finalised_slot_start, finalised_slot_end, venue_id, status')
    .eq('id', gatheringId)
    .eq('host_user_id', userId)
    .is('deleted_at', null)
    .maybeSingle();
  if (gErr || !g) return { ok: false, error: 'Gathering not found' };
  if (g.status !== 'live') return { ok: false, error: 'Gathering must be live to add to calendar' };
  if (!g.finalised_slot_start || !g.finalised_slot_end) {
    return { ok: false, error: 'Gathering has no finalised slot' };
  }

  const connection = await getConnectionForUser(userId, 'google');
  if (!connection) {
    return { ok: false, error: 'No active Google calendar connection. Connect one first under Calendar Connections.' };
  }

  let venueName: string | null = null;
  if (g.venue_id) {
    const { data: v } = await sb.from('venues').select('name, city').eq('id', g.venue_id).maybeSingle();
    venueName = v ? `${v.name}${v.city ? ` — ${v.city}` : ''}` : null;
  }

  try {
    const adapter = adapterFor('google');
    const result = await adapter.createEvent(connection.id, {
      title: g.title as string,
      description: (g.description as string) ?? undefined,
      startISO: g.finalised_slot_start as string,
      endISO: g.finalised_slot_end as string,
      location: venueName ?? undefined,
    });
    await appendEvent(gatheringId, userId, 'calendar_event_added', {
      provider: 'google',
      provider_event_id: result.providerEventId,
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    await appendEvent(gatheringId, userId, 'calendar_event_failed', { error: msg.slice(0, 200) });
    return { ok: false, error: msg };
  }
}

export async function cancelGathering(gatheringId: string): Promise<Result> {
  const a = await authedUser();
  if ('error' in a) return { ok: false, error: a.error };
  const userId = a.userId;

  const sb = admin();
  // ownership-ok: host_user_id filter (KAN-236)
  const { data: g, error: gErr } = await sb
    .from('gatherings')
    .select('id, status')
    .eq('id', gatheringId)
    .eq('host_user_id', userId)
    .is('deleted_at', null)
    .maybeSingle();
  if (gErr || !g) return { ok: false, error: 'Gathering not found' };

  let nextStatus: GatheringStatus;
  try {
    nextStatus = applyTransition(g.status as GatheringStatus, 'cancel');
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Invalid transition' };
  }

  // ownership-ok: explicit host_user_id filter (KAN-236)
  const { error: upErr } = await sb
    .from('gatherings')
    .update({ status: nextStatus })
    .eq('id', gatheringId)
    .eq('host_user_id', userId);
  if (upErr) return { ok: false, error: upErr.message };

  await appendEvent(gatheringId, userId, 'gathering_cancelled', {
    from_status: g.status,
    to_status: nextStatus,
  });

  return { ok: true };
}

/**
 * KAN-306 — finalise a draft gathering (draft → live) by locking a slot (and an
 * optional venue). This is the web equivalent of lyra_finalise_gathering, and
 * the precursor to sending invites.
 */
export async function finaliseGathering(
  gatheringId: string,
  slotStartISO: string,
  slotEndISO: string,
  venueId?: string | null
): Promise<Result> {
  const a = await authedUser();
  if ('error' in a) return { ok: false, error: a.error };
  const userId = a.userId;

  const start = new Date(slotStartISO);
  const end = new Date(slotEndISO);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { ok: false, error: 'Pick a valid time' };
  if (end <= start) return { ok: false, error: 'The end time must be after the start time' };

  const sb = admin();
  // ownership-ok: host_user_id filter (KAN-306)
  const { data: g, error: gErr } = await sb
    .from('gatherings')
    .select('id, status')
    .eq('id', gatheringId)
    .eq('host_user_id', userId)
    .is('deleted_at', null)
    .maybeSingle();
  if (gErr || !g) return { ok: false, error: 'Gathering not found' };

  let nextStatus: GatheringStatus;
  try {
    nextStatus = applyTransition(g.status as GatheringStatus, 'finalise');
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Cannot finalise from this state' };
  }

  if (venueId) {
    const { data: venue } = await sb.from('venues').select('id').eq('id', venueId).maybeSingle();
    if (!venue) return { ok: false, error: 'That venue could not be found' };
  }

  // ownership-ok: explicit host_user_id filter (KAN-306)
  const { error: upErr } = await sb
    .from('gatherings')
    .update({
      status: nextStatus,
      finalised_slot_start: slotStartISO,
      finalised_slot_end: slotEndISO,
      venue_id: venueId ?? null,
    })
    .eq('id', gatheringId)
    .eq('host_user_id', userId);
  if (upErr) return { ok: false, error: upErr.message };

  await appendEvent(gatheringId, userId, 'gathering_finalised', {
    from_status: g.status,
    to_status: nextStatus,
    slot_start: slotStartISO,
    slot_end: slotEndISO,
    venue_id: venueId ?? null,
  });
  return { ok: true };
}

/**
 * KAN-306 — queue + send invites for a finalised gathering, then drain the
 * queue synchronously (Vercel cron does not fire on preview branches, CLAUDE.md
 * Gotcha #21). Per-recipient dedup: invitees that already have a queued/sent
 * message are skipped. Allowlist + sender verification are env gates (KAN-308);
 * blocked sends stay queued and surface in the summary.
 */
export async function sendInvites(
  gatheringId: string
): Promise<{ ok: true; summary: SendSummary } | { ok: false; error: string }> {
  const a = await authedUser();
  if ('error' in a) return { ok: false, error: a.error };
  const userId = a.userId;

  const sb = admin();
  // ownership-ok: host_user_id filter (KAN-306)
  const { data: g } = await sb
    .from('gatherings')
    .select('id, status, finalised_slot_start')
    .eq('id', gatheringId)
    .eq('host_user_id', userId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!g) return { ok: false, error: 'Gathering not found' };
  if (!g.finalised_slot_start) return { ok: false, error: 'Finalise a time before sending invites' };
  if (g.status === 'cancelled' || g.status === 'completed') {
    return { ok: false, error: `Cannot send invites for a ${g.status} gathering` };
  }

  // ownership-ok: invitees scoped to the host's verified gathering (KAN-306)
  const { data: invitees } = await sb
    .from('gathering_invitees')
    .select('id, status')
    .eq('gathering_id', gatheringId);
  const active = (invitees ?? []).filter((i) => i.status !== 'cancelled');
  if (active.length === 0) return { ok: false, error: 'There is no one to invite yet' };

  // Dedup: skip invitees that already have a live (queued/sent/...) message.
  // ownership-ok: messages scoped to the host's verified gathering (KAN-306)
  const { data: msgs } = await sb
    .from('gathering_invite_messages')
    .select('invitee_id, delivery_status')
    .eq('gathering_id', gatheringId);
  const alreadyLive = new Set(
    (msgs ?? [])
      .filter((m) => ['queued', 'sent', 'delivered', 'opened', 'clicked'].includes(m.delivery_status as string))
      .map((m) => m.invitee_id)
  );

  let queued = 0;
  for (const inv of active) {
    if (alreadyLive.has(inv.id)) continue;
    const token = generateRsvpToken();
    await setInviteeRsvpToken(inv.id, token);
    await persistQueuedInvite({ gatheringId, inviteeId: inv.id, channel: 'email', templateName: 'convene-invite' });
    queued++;
  }

  await appendEvent(gatheringId, userId, 'gathering_invite_sent', { queued, source: 'web' });

  const summary = await dispatchQueuedInvites({ hostUserId: userId });
  return {
    ok: true,
    summary: {
      queued,
      sent: summary.sent,
      blocked_by_allowlist: summary.blocked_by_allowlist,
      failed: summary.failed,
    },
  };
}

/** KAN-306 — re-queue a single invitee (rotates the RSVP token) and drain. */
export async function resendInvite(inviteeId: string): Promise<Result> {
  const a = await authedUser();
  if ('error' in a) return { ok: false, error: a.error };
  const userId = a.userId;

  const sb = admin();
  const { data: inv } = await sb
    .from('gathering_invitees')
    .select('id, gathering_id, status')
    .eq('id', inviteeId)
    .maybeSingle();
  if (!inv) return { ok: false, error: 'Invite not found' };
  if (inv.status === 'cancelled') return { ok: false, error: 'That invite was cancelled' };

  // ownership-ok: verify the parent gathering is owned by the host (KAN-306)
  const { data: g } = await sb
    .from('gatherings')
    .select('id, finalised_slot_start')
    .eq('id', inv.gathering_id)
    .eq('host_user_id', userId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!g) return { ok: false, error: 'Gathering not found' };
  if (!g.finalised_slot_start) return { ok: false, error: 'Finalise a time before sending invites' };

  const token = generateRsvpToken();
  await setInviteeRsvpToken(inviteeId, token);
  await persistQueuedInvite({ gatheringId: inv.gathering_id, inviteeId, channel: 'email', templateName: 'convene-invite' });
  await appendEvent(inv.gathering_id, userId, 'gathering_invite_sent', { invitee_id: inviteeId, resend: true, source: 'web' });
  await dispatchQueuedInvites({ hostUserId: userId });
  return { ok: true };
}

/** KAN-306 — cancel a single invite: mark the invitee cancelled + invalidate its RSVP token. */
export async function cancelInvite(inviteeId: string): Promise<Result> {
  const a = await authedUser();
  if ('error' in a) return { ok: false, error: a.error };
  const userId = a.userId;

  const sb = admin();
  const { data: inv } = await sb
    .from('gathering_invitees')
    .select('id, gathering_id')
    .eq('id', inviteeId)
    .maybeSingle();
  if (!inv) return { ok: false, error: 'Invite not found' };

  // ownership-ok: verify the parent gathering is owned by the host (KAN-306)
  const { data: g } = await sb
    .from('gatherings')
    .select('id')
    .eq('id', inv.gathering_id)
    .eq('host_user_id', userId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!g) return { ok: false, error: 'Gathering not found' };

  // ownership-ok: update invitee on the host's verified gathering (KAN-306)
  const { error } = await sb
    .from('gathering_invitees')
    .update({ status: 'cancelled', rsvp_token: null, rsvp_token_expires_at: null })
    .eq('id', inviteeId);
  if (error) return { ok: false, error: 'Could not cancel the invite' };

  await appendEvent(inv.gathering_id, userId, 'invitee_cancelled', { invitee_id: inviteeId });
  return { ok: true };
}
