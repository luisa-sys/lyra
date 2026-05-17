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

type Result = { ok: true } | { ok: false; error: string };

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
