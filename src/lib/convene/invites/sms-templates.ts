/**
 * SMS / WhatsApp invite body templates — KAN-214 P10.
 *
 * SMS has a hard 160-char limit per segment; WhatsApp doesn't but the
 * etiquette is short messages. We aim for a single SMS segment in the
 * common case. Long titles get truncated.
 *
 * Format (≤160 chars typical):
 *   Hi <name>, <host> would like to gather: <title> on <date>. RSVP: <url>
 *
 * No personalisation beyond the strict minimum — every char counts.
 */

export interface SmsTemplateInput {
  hostName: string;
  recipientName?: string;
  gatheringTitle: string;
  startISO: string;
  rsvpUrl: string;
}

function fmtShortDate(iso: string): string {
  // E.g. "Mon 1 Jun"
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function firstNameOf(full: string): string {
  return full.split(' ')[0] ?? full;
}

const MAX_SMS_TITLE_LEN = 50;

export function renderSmsBody(input: SmsTemplateInput): string {
  const hostFirst = firstNameOf(input.hostName);
  const greeting = input.recipientName ? `Hi ${firstNameOf(input.recipientName)}, ` : '';
  const safeTitle =
    input.gatheringTitle.length > MAX_SMS_TITLE_LEN
      ? input.gatheringTitle.slice(0, MAX_SMS_TITLE_LEN - 1) + '…'
      : input.gatheringTitle;
  const when = fmtShortDate(input.startISO);
  return `${greeting}${hostFirst} would like to gather: ${safeTitle} on ${when}. RSVP: ${input.rsvpUrl}`;
}
