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

import { type SupabaseClient } from '@supabase/supabase-js';
import { createServiceRoleClient } from '@/modules/platform/supabase-service';
import { sendInviteEmail, type SendResult } from './email';
import { sendTwilioMessage, type SendResult as TwilioSendResult } from './twilio';
import { buildICS } from './ics';
import {
  renderInviteSubject,
  renderInvitePlainText,
  renderInviteHtml,
} from './templates';
import { renderSmsBody } from './sms-templates';
import { isFeatureEnabledByUserId } from '@/modules/features/entitlements-service';
import { getAccountStanding, shouldRefuseIssuance } from '@/lib/account-status';

const SITE_URL = process.env.LYRA_SITE_URL ?? 'https://checklyra.com';
const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_CONCURRENCY = 3;
// BUGS-62: a row claimed to 'sending' by a run that then crashed (or timed out —
// the route caps at maxDuration=60s) would otherwise be orphaned forever. A
// later run reclaims any 'sending' row older than this window back to 'queued'.
// The narrow edge where the original run actually sent before dying re-sends on
// reclaim — same as the pre-BUGS-62 behaviour (a crashed send left the row
// 'queued' and the next cron re-sent it), so this is not a regression. A
// provider idempotency key (Resend Idempotency-Key = message row id) is the
// planned backstop for that edge; deferred (needs a sign-off to update the
// KAN-214 source-guard test that pins the exact sendInviteEmail(...) call).
const STALE_CLAIM_MINUTES = 15;

const CLAIM_COLUMNS = 'id, gathering_id, invitee_id, channel, template_name';

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
  recipientEmail: string | null;
  recipientPhone: string | null; // E.164, KAN-214 P10
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
  return createServiceRoleClient();
}

/**
 * KAN-309: SMS/WhatsApp invites are a per-HOST paid entitlement
 * (convene_paid_channels). Resolved at most once per host per dispatch run.
 */
async function hostHasPaidChannels(
  hostUserId: string,
  cache: Map<string, boolean>,
): Promise<boolean> {
  const hit = cache.get(hostUserId);
  if (hit !== undefined) return hit;
  const ok = await isFeatureEnabledByUserId(hostUserId, 'convene_paid_channels');
  cache.set(hostUserId, ok);
  return ok;
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

  // 2. Contact methods — pull email + phone in one query, pick primary of each.
  const { data: methods } = await sb
    .from('contact_methods')
    .select('value, kind, is_primary')
    .eq('contact_id', inv.contact.id)
    .in('kind', ['email', 'phone', 'whatsapp', 'imessage']);
  const all = (methods ?? []) as Array<{ value: string; kind: string; is_primary: boolean }>;
  const emails = all.filter((m) => m.kind === 'email');
  const phones = all.filter(
    (m) => m.kind === 'phone' || m.kind === 'whatsapp' || m.kind === 'imessage'
  );
  const primaryEmail = (emails.find((m) => m.is_primary) ?? emails[0])?.value ?? null;
  const primaryPhone = (phones.find((m) => m.is_primary) ?? phones[0])?.value ?? null;
  if (!primaryEmail && !primaryPhone) {
    return { ok: false, reason: 'no contact methods (email or phone) on contact' };
  }

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
      recipientEmail: primaryEmail,
      recipientPhone: primaryPhone,
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
  const recipientEmail = ctx.recipientEmail ?? '';
  const ics = buildICS({
    uid: `gathering-${ctx.gatheringId}@checklyra.com`,
    title: ctx.gatheringTitle,
    startISO: ctx.startISO,
    endISO: ctx.endISO,
    location: ctx.venueLabel ?? undefined,
    organizerEmail: ctx.hostEmail,
    organizerName: ctx.hostDisplayName,
    attendeeEmail: recipientEmail,
    attendeeName: ctx.recipientName,
  });
  return {
    to: recipientEmail,
    fromName: `${ctx.hostDisplayName} via Lyra Convene`,
    subject,
    html,
    plainText,
    icsContent: ics,
  };
}

/**
 * Render a one-line SMS / WhatsApp body for a queued invite — KAN-214 P10.
 */
export function buildSmsBody(ctx: JoinedContext): string {
  return renderSmsBody({
    hostName: ctx.hostDisplayName,
    recipientName: ctx.recipientName,
    gatheringTitle: ctx.gatheringTitle,
    startISO: ctx.startISO,
    rsvpUrl: `${SITE_URL}/r/${ctx.rsvpToken}`,
  });
}

async function processOne(
  sb: SupabaseClient,
  row: QueuedRow,
  summary: DispatchSummary,
  paidChannelCache: Map<string, boolean>
): Promise<void> {
  const loaded = await loadContext(sb, row);
  if (!loaded.ok) {
    if (loaded.reason === 'not_finalised') {
      // BUGS-62: transient — release the claim so it retries once finalised.
      await releaseClaim(sb, row.id);
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

  const ctx = loaded.ctx;
  let result: SendResult | TwilioSendResult;
  try {
    if (row.channel === 'sms' || row.channel === 'whatsapp') {
      // KAN-309: paid channels require the host's convene_paid_channels entitlement.
      if (!(await hostHasPaidChannels(ctx.hostUserId, paidChannelCache))) {
        await sb
          .from('gathering_invite_messages')
          .update({
            delivery_status: 'failed',
            bounce_reason: 'convene_paid_channels not enabled for host',
          })
          .eq('id', row.id);
        summary.failed++;
        summary.errors.push(`${row.id}: convene_paid_channels not enabled`);
        return;
      }
      if (!ctx.recipientPhone) {
        await sb
          .from('gathering_invite_messages')
          .update({ delivery_status: 'failed', bounce_reason: 'no phone on contact' })
          .eq('id', row.id);
        summary.failed++;
        summary.errors.push(`${row.id}: no phone on contact`);
        return;
      }
      // BUGS-62: Twilio's Messages API has no idempotency-key header, so the
      // atomic 'sending' claim above is the double-send guard for SMS/WhatsApp.
      result = await sendTwilioMessage({
        to: ctx.recipientPhone,
        channel: row.channel,
        body: buildSmsBody(ctx),
      });
    } else if (row.channel === 'email') {
      if (!ctx.recipientEmail) {
        await sb
          .from('gathering_invite_messages')
          .update({ delivery_status: 'failed', bounce_reason: 'no email on contact' })
          .eq('id', row.id);
        summary.failed++;
        summary.errors.push(`${row.id}: no email on contact`);
        return;
      }
      result = await sendInviteEmail(buildSendInputs(ctx));
    } else {
      await sb
        .from('gathering_invite_messages')
        .update({
          delivery_status: 'failed',
          bounce_reason: `unsupported channel: ${row.channel}`,
        })
        .eq('id', row.id);
      summary.failed++;
      summary.errors.push(`${row.id}: unsupported channel ${row.channel}`);
      return;
    }
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
    // BUGS-62: transient — release the claim so it ships once allow-listed.
    await releaseClaim(sb, row.id);
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

/**
 * BUGS-62 — atomic queue claim. Flips the given queued rows to 'sending' in a
 * single UPDATE guarded by `delivery_status = 'queued'`, and RETURNs only the
 * rows this call actually changed. Under concurrent dispatch runs the guard
 * makes the claim race-safe: Postgres row-locks serialise the two UPDATEs, the
 * loser re-evaluates its WHERE against the now-'sending' row and matches nothing,
 * so each queued row is claimed (and therefore sent) by at most one run.
 */
async function claimQueuedRows(
  sb: SupabaseClient,
  ids: string[],
  nowIso: string
): Promise<QueuedRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await sb
    .from('gathering_invite_messages')
    .update({ delivery_status: 'sending', claimed_at: nowIso })
    .in('id', ids)
    .eq('delivery_status', 'queued')
    .select(CLAIM_COLUMNS);
  if (error) throw new Error(`queue claim failed: ${error.message}`);
  return (data as unknown as QueuedRow[]) ?? [];
}

/**
 * BUGS-62 — release a claimed row back to 'queued' (clearing claimed_at) when it
 * was claimed but not actually sent: allow-list blocks and not-yet-finalised
 * gatherings are transient conditions that should retry on a later run, so the
 * row must NOT be left stranded in the transient 'sending' state.
 */
async function releaseClaim(sb: SupabaseClient, id: string): Promise<void> {
  await sb
    .from('gathering_invite_messages')
    .update({ delivery_status: 'queued', claimed_at: null })
    .eq('id', id);
}

export async function dispatchQueuedInvites(
  opts: { batchSize?: number; concurrency?: number; hostUserId?: string } = {}
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

  // When hostUserId is given, narrow to that user's gatherings only.
  // The MCP admin tool relies on this so one user can't drain another's queue.
  let gatheringIds: string[] | null = null;
  if (opts.hostUserId) {
    // SEC-81 / SEC-57 defence-in-depth: refuse to drain a suspended host's
    // queued invites (this is the per-host path used by the web actions and the
    // MCP drain tool). Fail CLOSED — a lookup error also refuses. The global
    // cron drain (no hostUserId) is unaffected; per-host refusal at the two
    // server actions is the primary gate.
    if (shouldRefuseIssuance(await getAccountStanding(sb, opts.hostUserId))) {
      summary.errors.push('host suspended — dispatch refused (SEC-81)');
      return summary;
    }
  }
  if (opts.hostUserId) {
    const { data: gatherings, error: gErr } = await sb
      .from('gatherings')
      .select('id')
      .eq('host_user_id', opts.hostUserId)
      .is('deleted_at', null);
    if (gErr) throw new Error(`gathering scan failed: ${gErr.message}`);
    gatheringIds = (gatherings ?? []).map((g: { id: string }) => g.id);
    if (gatheringIds.length === 0) return summary;
  }

  // BUGS-62 step 1 — reclaim orphaned 'sending' rows from a prior run that
  // crashed or timed out mid-batch (older than the staleness window) back to
  // 'queued', so a claimed-but-never-sent invite is not lost forever.
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MINUTES * 60_000).toISOString();
  let reclaim = sb
    .from('gathering_invite_messages')
    .update({ delivery_status: 'queued', claimed_at: null })
    .eq('delivery_status', 'sending')
    .lt('claimed_at', staleBefore);
  if (gatheringIds) reclaim = reclaim.in('gathering_id', gatheringIds);
  const { error: rErr } = await reclaim;
  if (rErr) throw new Error(`stale-claim reclaim failed: ${rErr.message}`);

  // BUGS-62 step 2 — read candidate queued ids (oldest-first, bounded).
  let candidateQuery = sb
    .from('gathering_invite_messages')
    .select('id')
    .eq('delivery_status', 'queued')
    .in('channel', ['email', 'sms', 'whatsapp'])
    .order('created_at', { ascending: true })
    .limit(batchSize);
  if (gatheringIds) candidateQuery = candidateQuery.in('gathering_id', gatheringIds);
  const { data: candidates, error: cErr } = await candidateQuery;
  if (cErr) throw new Error(`queue scan failed: ${cErr.message}`);
  const candidateIds = ((candidates as { id: string }[]) ?? []).map((r) => r.id);

  // BUGS-62 step 3 — atomically CLAIM the candidates: flip 'queued' -> 'sending'
  // guarded by delivery_status='queued'. Only the RETURNed rows are owned by
  // this run; a concurrent run racing on the same id loses the guard and claims
  // nothing, so no invite is ever processed (and sent) twice.
  const claimed = await claimQueuedRows(sb, candidateIds, new Date().toISOString());
  const queue = [...claimed];
  summary.scanned = queue.length;

  // KAN-309: per-host convene_paid_channels entitlement cache, shared across
  // the concurrent workers for this run.
  const paidChannelCache = new Map<string, boolean>();

  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const row = queue.shift();
          if (!row) break;
          await processOne(sb, row, summary, paidChannelCache);
        }
      })()
    );
  }
  await Promise.all(workers);
  return summary;
}

export const _internal = { loadContext, buildSendInputs, claimQueuedRows, releaseClaim };
