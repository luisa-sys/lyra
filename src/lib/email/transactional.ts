/**
 * KAN-276 — minimal transactional email sender (Resend).
 *
 * The Convene invite sender (`src/lib/convene/invites/email.ts`) is gated
 * behind CONVENE_INVITE_ALLOWLIST, which is the wrong gate for beta-access
 * notifications — we always want to email Luisa when someone joins the queue,
 * and to email an approved user when they're let in. So this is a tiny,
 * allowlist-free Resend wrapper for those two system emails.
 *
 * Degrade-gracefully contract: NEVER throws. If RESEND_API_KEY is unset or
 * Resend returns an error, it returns `{ ok: false, ... }` and the caller logs
 * + carries on. A failed beta-queue email must not break a user's sign-in.
 */

interface SendInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  fromName?: string;
  fromAddress?: string;
}

export type TransactionalSendResult =
  | { ok: true; messageId: string }
  | { ok: false; code: 'no_api_key' | 'send_failed'; detail?: string };

export async function sendTransactionalEmail(
  input: SendInput
): Promise<TransactionalSendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, code: 'no_api_key', detail: 'RESEND_API_KEY not set' };
  }

  const fromName = input.fromName ?? 'Lyra';
  const fromAddress =
    input.fromAddress ??
    process.env.BETA_NOTIFY_FROM_EMAIL ??
    'noreply@checklyra.com';

  try {
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
        text: input.text,
      }),
    });

    if (!res.ok) {
      const detailText = await res.text().catch(() => '');
      return {
        ok: false,
        code: 'send_failed',
        detail: `${res.status}: ${detailText.slice(0, 300)}`,
      };
    }

    const json = (await res.json()) as { id?: string };
    return { ok: true, messageId: json.id ?? 'unknown' };
  } catch (err) {
    // Network / fetch-layer error. Never propagate.
    return {
      ok: false,
      code: 'send_failed',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
