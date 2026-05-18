/**
 * Post-event loop — KAN-212 P8.
 *
 * Daily-cron logic that:
 *   1. Finds gatherings past their finalised_slot_end + 2 hour buffer that
 *      are still in a non-terminal state (live, rescheduled,
 *      awaiting_responses). The 2-hour buffer covers the actual event
 *      runtime — we don't mark a gathering complete the second it
 *      "should have ended".
 *   2. Transitions them to 'completed' and writes a gathering_completed
 *      event log row.
 *   3. Auto-marks invitees still in 'accepted' status as 'attended' so
 *      relationship_signals counts them correctly. (Hosts can override
 *      to 'no_show' via lyra_record_rsvp.)
 *   4. Refreshes the relationship_signals materialised view so the
 *      attendee scorer picks up the latest engagement data on the next
 *      lyra_propose_attendees call.
 *
 * Idempotent: re-running on the same set of past gatherings is a no-op
 * because the WHERE clause filters out already-completed rows.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

export interface PostEventSummary {
  scanned: number;
  completed: number;
  invitees_marked_attended: number;
  view_refreshed: boolean;
  errors: string[];
}

interface Gathering {
  id: string;
  host_user_id: string;
  status: string;
  finalised_slot_end: string;
  title: string;
}

const POST_EVENT_BUFFER_HOURS = 2;
const BATCH_SIZE = 100;

function admin(): SupabaseClient {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false },
  });
}

export async function runPostEventSweep(): Promise<PostEventSummary> {
  const sb = admin();
  const summary: PostEventSummary = {
    scanned: 0,
    completed: 0,
    invitees_marked_attended: 0,
    view_refreshed: false,
    errors: [],
  };

  const cutoff = new Date(Date.now() - POST_EVENT_BUFFER_HOURS * 60 * 60 * 1000);

  // 1. Find candidates.
  // ownership-ok: scanning across all hosts is the cron's purpose (KAN-212)
  const { data: rows, error } = await sb
    .from('gatherings')
    .select('id, host_user_id, status, finalised_slot_end, title')
    .in('status', ['live', 'rescheduled', 'awaiting_responses'])
    .not('finalised_slot_end', 'is', null)
    .lt('finalised_slot_end', cutoff.toISOString())
    .is('deleted_at', null)
    .order('finalised_slot_end', { ascending: true })
    .limit(BATCH_SIZE);
  if (error) {
    summary.errors.push(`scan: ${error.message}`);
    return summary;
  }
  const candidates = (rows as Gathering[]) ?? [];
  summary.scanned = candidates.length;

  // 2 + 3. For each, mark completed + flip accepted → attended.
  for (const g of candidates) {
    try {
      await sb
        .from('gatherings')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', g.id);

      const { count: attendedCount } = await sb
        .from('gathering_invitees')
        .update({
          status: 'attended',
          responded_at: new Date().toISOString(),
        }, { count: 'exact' })
        .eq('gathering_id', g.id)
        .eq('status', 'accepted');
      summary.invitees_marked_attended += attendedCount ?? 0;

      await sb.from('gathering_events_log').insert({
        gathering_id: g.id,
        actor_user_id: g.host_user_id,
        event_type: 'gathering_completed',
        metadata: {
          source: 'post_event_cron',
          attendees_marked: attendedCount ?? 0,
          finalised_slot_end: g.finalised_slot_end,
        },
      });
      summary.completed += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown';
      summary.errors.push(`${g.id}: ${msg.slice(0, 120)}`);
    }
  }

  // 4. Refresh the materialised view (best-effort; if it fails it's not fatal).
  try {
    const { error: rErr } = await sb.rpc('refresh_relationship_signals');
    if (rErr) throw new Error(rErr.message);
    summary.view_refreshed = true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    summary.errors.push(`refresh_relationship_signals: ${msg.slice(0, 120)}`);
  }

  return summary;
}
