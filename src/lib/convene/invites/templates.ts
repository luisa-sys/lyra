/**
 * Invite-email templates for Convene — KAN-209 (Phase 5).
 *
 * Plain-text first, HTML wraps the same content. Keeps things skim-readable
 * across all mail clients. Calm tone, no exclamation marks, no emojis in
 * the subject (clients punish those for spam).
 */

import type { GatheringStatus } from '@/lib/convene/gatherings/state-machine';

export interface InviteTemplateInput {
  hostName: string;
  recipientName?: string;
  gatheringTitle: string;
  gatheringType: string;
  startISO: string;
  endISO: string;
  venueLabel?: string;
  hostNote?: string;
  rsvpUrl: string;
  /** Optional inline "From the host" — the human note. */
  personalMessage?: string;
}

function fmtDateLong(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
}

export function renderInviteSubject(input: InviteTemplateInput): string {
  const first = input.hostName.split(' ')[0] ?? input.hostName;
  return `${first} would like to gather: ${input.gatheringTitle}`;
}

export function renderInvitePlainText(input: InviteTemplateInput): string {
  const greeting = input.recipientName ? `Hi ${input.recipientName.split(' ')[0]},` : 'Hi,';
  const when = fmtDateLong(input.startISO);
  const venue = input.venueLabel ? `Where: ${input.venueLabel}\n` : '';
  const personal = input.personalMessage ? `\nFrom ${input.hostName}:\n${input.personalMessage}\n` : '';
  const note = input.hostNote ? `\nNote from the host:\n${input.hostNote}\n` : '';
  return [
    `${greeting}`,
    ``,
    `${input.hostName} is hosting a ${input.gatheringType}: ${input.gatheringTitle}`,
    ``,
    `When: ${when}`,
    `${venue}`,
    `Could you make it? Respond here:`,
    `${input.rsvpUrl}`,
    `${personal}${note}`,
    `An iCal attachment is included so you can add this to your calendar with one click.`,
    ``,
    `— Sent via Lyra Convene (checklyra.com)`,
    `If you didn't expect this email, you can ignore it; we won't email you again unless ${input.hostName} sends another invite.`,
  ].join('\n');
}

export function renderInviteHtml(input: InviteTemplateInput): string {
  const greeting = input.recipientName ? `Hi ${input.recipientName.split(' ')[0]},` : 'Hi,';
  const when = fmtDateLong(input.startISO);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 32px auto; color: #2b2b2b; line-height: 1.5;">
  <p>${greeting}</p>
  <p><strong>${escapeHtml(input.hostName)}</strong> is hosting a ${escapeHtml(input.gatheringType)}:</p>
  <h2 style="margin: 8px 0; font-size: 22px;">${escapeHtml(input.gatheringTitle)}</h2>
  <p style="margin: 4px 0;"><strong>When:</strong> ${escapeHtml(when)}</p>
  ${input.venueLabel ? `<p style="margin: 4px 0;"><strong>Where:</strong> ${escapeHtml(input.venueLabel)}</p>` : ''}
  ${input.personalMessage ? `<blockquote style="border-left: 3px solid #cfd6c8; padding: 4px 12px; color: #555; margin: 16px 0;">${escapeHtml(input.personalMessage)}</blockquote>` : ''}
  ${input.hostNote ? `<p style="font-size: 14px; color: #555;"><em>Note from the host:</em> ${escapeHtml(input.hostNote)}</p>` : ''}
  <p style="margin: 24px 0;">
    <a href="${escapeAttr(input.rsvpUrl)}" style="display: inline-block; background: #6b8e6f; color: white; text-decoration: none; padding: 10px 20px; border-radius: 8px;">Respond to invite</a>
  </p>
  <p style="font-size: 13px; color: #888;">An iCal attachment is included — add to your calendar with one click.</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0 16px;">
  <p style="font-size: 12px; color: #888;">Sent via <a href="https://checklyra.com" style="color: #6b8e6f;">Lyra Convene</a>. If you didn't expect this email, ignore it — we won't email you again unless ${escapeHtml(input.hostName)} sends another invite.</p>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// Suppress unused-import warning — GatheringStatus may inform future templates.
type _Unused = GatheringStatus;
