/**
 * Invite dispatcher — KAN-209 (Phase 5 part 2).
 *
 * Reads queued rows from gathering_invite_messages, joins to invitee +
 * contact + contact_methods + gathering + venue + host, renders the email
 * templates, builds the ICS attachment, and calls Resend via sendInviteEmail
 * (which itself gates on CONVENE_INVITE_ALLOWLIST). On success marks the
 * row 'sent' and logs gathering_invite_delivered. On allowlist-block leaves
 * the row 'queued' so it ships once the recipient is allow-listed. On hard
 * failure marks 'failed' and logs gathering_invite_failed.
 *
 * The dispatcher is called from a Vercel cron route every 10 minutes (see
 * vercel.json) AND can be invoked one-shot from an admin tool later.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { sendInviteEmail, type SendResult } from './email';
import { buildICS } from './ics';
import {
  renderInviteSubject,
  renderInvitePlainText,
  renderInviteHtml,
} from './templates';

const SITE_URL = process.env.LYRA_SITE_URL ?? 'https://checklyra.com';
const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_CONCURRENCY = 3;

export interface DispatchSummary {
  scanned: number;
  sent: number;
  blocked_by_allowlist: number;
  failed: number;
  skipped_unfinalised: number;
  errors: string[];
}

interface QueuedRow {
  id: string;
  gathering_id: string;
  invitee_id: string;
  channel: string;
  template_name: string;
}

interface JoinedContext {
  recipientEmail: string;
  recipientName: string;
  rsvpToken: string;
  rsvpExpires: string | null;
  gatheringId: string;
  gatheringTitle: string;
  gatheringType: string;
  startISO: string;
  endISO: string;
  venueLabel: string | null;
  hostUserId: string;
  hostEmail: string;
  hostDisplayName: string;
}

function admin(): SupabaseClient {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false },
  });
}

async function loadContext(
  sb: SupabaseClient,
  row: QueuedRow
): Promise<{ ok: true; ctx: JoinedContext } | { ok: false; reason: string }> {
  // 1. Invitee + contact + token. ownership-ok: queued row gates this (KAN-209).
  const { data: invitee, error: iErr } = await sb
    .from('gathering_invitees')
    .select(`
      id, rsvp_token, rsvp_token_expires_at,
      contact:contacts(id, display_name)
    `)
    .eq('id', row.invitee_id)
    .maybeSingle();
  if (iErr || !invitee) return { ok: false, reason: `invitee not found: ${iErr?.message ?? 'no row'}` };
  const inv = invitee as unknown as {
    id: string;
    rsvp_token: string | null;
    rsvp_token_expires_at: string | null;
    contact: { id: string; display_name: string } | null;
  };
  if (!inv.contact) return { ok: false, reason: 'contact link missing' };
  if (!inv.rsvp_token) return { ok: false, reason: 'rsvp_token missing — re-queue from MCP' };

  // 2. Primary email for the contact.
  const { data: methods } = await sb
    .from('contact_methods')
    .select('value, is_primary')
    .eq('contact_id', inv.contact.id)
    .eq('kind', 'email');
  const allEmails = (methods ?? []) as Array<{ value: string; is_primary: boolean }>;
  const primary = allEmails.find((m) => m.is_primary) ?? allEmails[0];
  if (!primary) return { ok: false, reason: 'no email on contact' };

  // 3. Gathering + venue + host.
  const { data: g, error: gErr } = await sb
    .from('gatherings')
    .select(`
      id, host_user_id, title, gathering_type, status,
      finalised_slot_start, finalised_slot_end,
      venue:venues(name, city)
    `)
    .eq('id', row.gathering_id)
    .is('deleted_at', null)
    .maybeSingle();
  if (gErr || !g) return { ok: false, reason: `gathering not found: ${gErr?.message ?? 'no row'}` };
  const gat = g as unknown as {
    id: string;
    host_user_id: string;
    title: string;
    gathering_type: string;
    status: string;
    finalised_slot_start: string | null;
    finalised_slot_end: string | null;
    venue: { name: string; city: string | null } | null;
  };
  if (!gat.finalised_slot_start || !gat.finalised_slot_end) {
    return { ok: false, reason: 'not_finalised' };
  }

  // 4. Host identity — auth.users.email + display name from profiles if present.
  const { data: hostAuth } = await sb.auth.admin.getUserById(gat.host_user_id);
  const hostEmail = hostAuth?.user?.email ?? 'host@checklyra.com';
  const { data: hostProfile } = await sb
    .from('profiles')
    .select('display_name')
    .eq('user_id', gat.host_user_id)
    .maybeSingle();
  const hostDisplayName =
    (hostProfile as { display_name?: string } | null)?.display_name ?? hostEmail.split('@')[0];

  return {
    ok: true,
    ctx: {
      recipientEmail: primary.value,
      recipientName: inv.contact.display_name,
      rsvpToken: inv.rsvp_token,
      rsvpExpires: inv.rsvp_token_expires_at,
      gatheringId: gat.id,
      gatheringTitle: gat.title,
      gatheringType: gat.gathering_type,
      startISO: gat.finalised_slot_start,
      endISO: gat.finalised_slot_end,
      venueLabel: gat.venue ? `${gat.venue.name}${gat.venue.city ? ` — ${gat.venue.city}` : ''}` : null,
      hostUserId: gat.host_user_id,
      hostEmail,
      hostDisplayName,
    },
  };
}

export function buildSendInputs(ctx: JoinedContext) {
  const rsvpUrl = `${SITE_URL}/r/${ctx.rsvpToken}`;
  const tpl = {
    hostName: ctx.hostDisplayName,
    recipientName: ctx.recipientName,
    gatheringTitle: ctx.gatheringTitle,
    gatheringType: ctx.gatheringType,
    startISO: ctx.startISO,
    endISO: ctx.endISO,
    venueLabel: ctx.venueLabel ?? undefined,
    rsvpUrl,
  };
  const subject = renderInviteSubject(tpl);
  const plainText = renderInvitePlainText(tpl);
  const html = renderInviteHtml(tpl);
  const ics = buildICS({
    uid: `gathering-${ctx.gatheringId}@checklyra.com`,
    title: ctx.gatheringTitle,
    startISO: ctx.startISO,
    endISO: ctx.endISO,
    location: ctx.venueLabel ?? undefined,
    organizerEmail: ctx.hostEmail,
    organizerName: ctx.hostDisplayName,
    attendeeEmail: ctx.recipientEmail,
    attendeeName: ctx.recipientName,
  });
  return {
    to: ctx.recipientEmail,
    fromName: `${ctx.hostDisplayName} via Lyra Convene`,
    subject,
    html,
    plainText,
    icsContent: ics,
  };
}

async function processOne(
  sb: SupabaseClient,
  row: QueuedRow,
  summary: DispatchSummary
): Promise<void> {
  const loaded = await loadContext(sb, row);
  if (!loaded.ok) {
    if (loaded.reason === 'not_finalised') {
      summary.skipped_unfinalised++;
      return;
    }
    summary.failed++;
    summary.errors.push(`${row.id}: ${loaded.reason.slice(0, 120)}`);
    await sb
      .from('gathering_invite_messages')
      .update({ delivery_status: 'failed', bounce_reason: loaded.reason.slice(0, 500) })
      .eq('id', row.id);
    await sb.from('gathering_events_log').insert({
      gathering_id: row.gathering_id,
      event_type: 'gathering_invite_failed',
      subject_kind: 'invitee',
      subject_id: row.invitee_id,
      metadata: { message_id: row.id, reason: loaded.reason.slice(0, 200) },
    });
    return;
  }

  const send = buildSendInputs(loaded.ctx);
  let result: SendResult;
  try {
    result = await sendInviteEmail(send);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    summary.failed++;
    summary.errors.push(`${row.id}: ${msg.slice(0, 120)}`);
    await sb
      .from('gathering_invite_messages')
      .update({ delivery_status: 'failed', bounce_reason: msg.slice(0, 500) })
      .eq('id', row.id);
    return;
  }

  if (result.ok) {
    summary.sent++;
    await sb
      .from('gathering_invite_messages')
      .update({
        delivery_status: 'sent',
        sent_at: new Date().toISOString(),
        external_message_id: result.messageId,
      })
      .eq('id', row.id);
    await sb.from('gathering_events_log').insert({
      gathering_id: row.gathering_id,
      event_type: 'gathering_invite_delivered',
      subject_kind: 'invitee',
      subject_id: row.invitee_id,
      metadata: {
        message_id: row.id,
        external_message_id: result.messageId,
        channel: row.channel,
      },
    });
    return;
  }

  if (result.code === 'not_in_allowlist') {
    summary.blocked_by_allowlist++;
    return;
  }
  summary.failed++;
  const detail = result.detail ?? result.code;
  summary.errors.push(`${row.id}: ${detail.slice(0, 120)}`);
  await sb
    .from('gathering_invite_messages')
    .update({ delivery_status: 'failed', bounce_reason: detail.slice(0, 500) })
    .eq('id', row.id);
  await sb.from('gathering_events_log').insert({
    gathering_id: row.gathering_id,
    event_type: 'gathering_invite_failed',
    subject_kind: 'invitee',
    subject_id: row.invitee_id,
    metadata: { message_id: row.id, code: result.code, detail: detail.slice(0, 200) },
  });
}

export async function dispatchQueuedInvites(
  opts: { batchSize?: number; concurrency?: number } = {}
): Promise<DispatchSummary> {
  const sb = admin();
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;

  const summary: DispatchSummary = {
    scanned: 0,
    sent: 0,
    blocked_by_allowlist: 0,
    failed: 0,
    skipped_unfinalised: 0,
    errors: [],
  };

  const { data: rows, error } = await sb
    .from('gathering_invite_messages')
    .select('id, gathering_id, invitee_id, channel, template_name')
    .eq('delivery_status', 'queued')
    .eq('channel', 'email')
    .order('created_at', { ascending: true })
    .limit(batchSize);
  if (error) throw new Error(`queue scan failed: ${error.message}`);
  const queue = [...((rows as QueuedRow[]) ?? [])];
  summary.scanned = queue.length;

  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const row = queue.shift();
          if (!row) break;
          await processOne(sb, row, summary);
        }
      })()
    );
  }
  await Promise.all(workers);
  return summary;
}

export const _internal = { loadContext, buildSendInputs };
