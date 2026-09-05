/**
 * KAN-276 / KAN-277 (epic KAN-273): transactional emails for the beta-access
 * programme. Modelled on src/lib/convene/invites/email.ts (Resend REST API).
 *
 *   - sendBetaQueueNotice:   tells the admin (Luisa) a new person joined the queue.
 *   - sendBetaApprovedEmail: tells an approved user "you're in" + the beta link.
 *
 * Graceful degradation: if RESEND_API_KEY is unset the send is a no-op that
 * returns { ok:false, code:'no_api_key' } and logs a WARNING (never a silent
 * skip). Signup / approval must not crash just because email is unconfigured.
 *
 * Recipient + sender are env-overridable:
 *   - LYRA_BETA_NOTIFY_EMAIL (default luisa@santos-stephens.com) — queue notices
 *   - LYRA_BETA_FROM_EMAIL   (default hello@checklyra.com)       — From address
 */
export type BetaEmailResult =
  | { ok: true; messageId: string }
  | { ok: false; code: 'no_api_key' | 'send_failed'; detail?: string };

const BETA_URL = 'https://beta.checklyra.com';
const from = () => process.env.LYRA_BETA_FROM_EMAIL ?? 'hello@checklyra.com';
const notifyTo = () => process.env.LYRA_BETA_NOTIFY_EMAIL ?? 'luisa@santos-stephens.com';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function send(
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<BetaEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(`[beta-access] RESEND_API_KEY not set — email to ${to} not sent ("${subject}")`);
    return { ok: false, code: 'no_api_key' };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `Lyra <${from()}>`, to: [to], subject, html, text }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { ok: false, code: 'send_failed', detail };
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return { ok: true, messageId: data.id ?? '' };
}

export function sendBetaQueueNotice(input: {
  userEmail: string;
  displayName?: string | null;
}): Promise<BetaEmailResult> {
  const name = input.displayName?.trim() || input.userEmail;
  const subject = `New Lyra beta request: ${input.userEmail}`;
  const html =
    `<p>${escapeHtml(name)} (${escapeHtml(input.userEmail)}) just joined the Lyra beta queue.</p>` +
    `<p>Review &amp; approve them from the admin beta queue.</p>`;
  const text =
    `${name} (${input.userEmail}) just joined the Lyra beta queue. ` +
    `Review & approve them from the admin beta queue.`;
  return send(notifyTo(), subject, html, text);
}

export function sendBetaApprovedEmail(input: { to: string }): Promise<BetaEmailResult> {
  const subject = `You're in — welcome to the Lyra beta`;
  const html =
    `<p>Good news — you've been approved for the Lyra beta.</p>` +
    `<p><a href="${BETA_URL}">Open Lyra</a> and start building your profile.</p>`;
  const text =
    `Good news — you've been approved for the Lyra beta. ` +
    `Open Lyra at ${BETA_URL} and start building your profile.`;
  return send(input.to, subject, html, text);
}
