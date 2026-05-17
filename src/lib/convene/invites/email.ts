/**
 * Resend email sender for Convene invites — KAN-209 (Phase 5).
 *
 * Sends a single invite email via Resend's REST API. Attaches the ICS
 * calendar event so the recipient can add it to their calendar with one
 * click.
 *
 * Allowlist gate: CONVENE_INVITE_ALLOWLIST is a comma-separated list of
 * lowercased email addresses (or wildcard "*"). If unset OR the recipient
 * isn't in the list, send is BLOCKED at this layer and the function returns
 * `{ ok: false, code: 'not_in_allowlist' }`. This protects against
 * accidental spam during P5 testing before the beta cohort is finalised.
 */

interface SendInput {
  to: string;
  fromName?: string;
  subject: string;
  html: string;
  plainText: string;
  icsContent?: string;
  /** Replaces the ICS attachment filename. Defaults to "convene-invite.ics". */
  icsFilename?: string;
}

export type SendResult =
  | { ok: true; messageId: string }
  | { ok: false; code: 'no_api_key' | 'not_in_allowlist' | 'send_failed'; detail?: string };

function isAllowed(to: string): boolean {
  const allowlist = (process.env.CONVENE_INVITE_ALLOWLIST ?? '').trim();
  if (allowlist === '*') return true;
  if (allowlist === '') return false;
  const target = to.toLowerCase();
  return allowlist
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .includes(target);
}

export async function sendInviteEmail(input: SendInput): Promise<SendResult> {
  if (!isAllowed(input.to)) {
    return { ok: false, code: 'not_in_allowlist' };
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, code: 'no_api_key', detail: 'RESEND_API_KEY not set' };
  }

  const fromName = input.fromName ?? 'Lyra Convene';
  const fromAddress = process.env.CONVENE_INVITE_FROM_EMAIL ?? 'invites@checklyra.com';

  const attachments = input.icsContent
    ? [
        {
          filename: input.icsFilename ?? 'convene-invite.ics',
          content: Buffer.from(input.icsContent, 'utf8').toString('base64'),
          contentType: 'text/calendar; charset=utf-8; method=REQUEST',
        },
      ]
    : undefined;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${fromName} <${fromAddress}>`,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.plainText,
      attachments,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, code: 'send_failed', detail: `${res.status}: ${text.slice(0, 300)}` };
  }
  const json = (await res.json()) as { id?: string };
  return { ok: true, messageId: json.id ?? 'unknown' };
}

export const _internal = { isAllowed };
