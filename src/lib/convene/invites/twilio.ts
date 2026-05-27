/**
 * Twilio sender for Convene invites — KAN-214 P10.
 *
 * Sends SMS and WhatsApp messages via Twilio's REST API. Mirrors the
 * email.ts shape: allowlist gate at the front, fire-and-forget POST,
 * structured SendResult for the dispatcher to interpret.
 *
 * Allowlist gate: CONVENE_INVITE_SMS_ALLOWLIST is a comma-separated
 * list of phone numbers in E.164 (`+44…`) format, or `*` for wildcard.
 * Unset/empty → all sends blocked (safety default — same posture as
 * the email allowlist).
 *
 * No npm dependency on the Twilio Node SDK — we hit the REST API with
 * fetch directly. Twilio's responses are JSON; auth is HTTP Basic with
 * the Account SID as the user and Auth Token as the password.
 */

interface SendInput {
  to: string; // E.164, e.g. +447123456789
  channel: 'sms' | 'whatsapp';
  body: string;
}

export type SendResult =
  | { ok: true; messageId: string }
  | {
      ok: false;
      code:
        | 'no_credentials'
        | 'no_from_number'
        | 'not_in_allowlist'
        | 'send_failed';
      detail?: string;
    };

function isAllowed(phone: string): boolean {
  const allowlist = (process.env.CONVENE_INVITE_SMS_ALLOWLIST ?? '').trim();
  if (allowlist === '*') return true;
  if (allowlist === '') return false;
  const target = phone.trim().toLowerCase();
  return allowlist
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .includes(target);
}

export async function sendTwilioMessage(input: SendInput): Promise<SendResult> {
  if (!isAllowed(input.to)) {
    return { ok: false, code: 'not_in_allowlist' };
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    return { ok: false, code: 'no_credentials', detail: 'TWILIO_ACCOUNT_SID/AUTH_TOKEN not set' };
  }

  const from =
    input.channel === 'whatsapp'
      ? process.env.TWILIO_WHATSAPP_FROM
      : process.env.TWILIO_SMS_FROM;
  if (!from) {
    return {
      ok: false,
      code: 'no_from_number',
      detail: `TWILIO_${input.channel === 'whatsapp' ? 'WHATSAPP' : 'SMS'}_FROM not set`,
    };
  }

  const fromQualified = input.channel === 'whatsapp' ? `whatsapp:${from}` : from;
  const toQualified = input.channel === 'whatsapp' ? `whatsapp:${input.to}` : input.to;

  const body = new URLSearchParams({
    From: fromQualified,
    To: toQualified,
    Body: input.body,
  });

  const authHeader = `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
    {
      method: 'POST',
      headers: {
        authorization: authHeader,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return {
      ok: false,
      code: 'send_failed',
      detail: `${res.status}: ${text.slice(0, 300)}`,
    };
  }

  const json = (await res.json()) as { sid?: string; error_message?: string };
  return { ok: true, messageId: json.sid ?? 'unknown' };
}

export const _internal = { isAllowed };
