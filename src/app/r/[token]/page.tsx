/**
 * /r/[token] — KAN-209 (Phase 5).
 *
 * Public RSVP page. No login required — the opaque token in the URL is the
 * sole credential. Token verified server-side via getInviteeByToken. On
 * submission, server action records the response + appends to audit log.
 *
 * UX: minimal — one card with the gathering summary + accept/decline/
 * tentative buttons. No back-and-forth, no plus-one (deferred to next P5
 * iteration), no edit-after-response (re-clicking the link rotates response).
 */

import { isConveneEnabled } from '@/lib/convene/flags';
import { getInviteeByToken } from '@/lib/convene/invites/repository';
import { RsvpForm } from './rsvp-form';

export const metadata = {
  title: 'Respond — Lyra Convene',
  description: 'Respond to your Convene invite.',
  robots: { index: false, follow: false },
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default async function RsvpPage({ params }: { params: Promise<{ token: string }> }) {
  if (!isConveneEnabled()) {
    return errorPage('Convene is not enabled in this environment.');
  }

  const { token } = await params;
  const invitee = await getInviteeByToken(token);
  if (!invitee) {
    return errorPage('Invalid or expired invitation link.', 'If you think this is a mistake, ask the host to resend.');
  }
  if (invitee.tokenExpiresAt && new Date(invitee.tokenExpiresAt) < new Date()) {
    return errorPage('This invitation link has expired.', 'Ask the host to resend if you still want to respond.');
  }

  const slot = invitee.finalisedSlotStart
    ? `${fmtDate(invitee.finalisedSlotStart)}`
    : 'Time not finalised yet';

  return (
    <main className="min-h-screen bg-[var(--color-paper)] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-xl border border-[var(--color-border)] p-8 space-y-6">
        <div>
          <p className="text-sm text-[var(--color-muted)] uppercase">You&apos;re invited to</p>
          <h1 className="text-2xl font-medium text-[var(--color-ink)] mt-1">{invitee.gatheringTitle}</h1>
          <p className="text-sm text-[var(--color-muted)] mt-1">({invitee.gatheringType})</p>
        </div>

        <div className="space-y-2 text-sm">
          <div>
            <p className="text-xs text-[var(--color-muted)] uppercase">When</p>
            <p className="text-[var(--color-ink)]">{slot}</p>
          </div>
          {invitee.venueName && (
            <div>
              <p className="text-xs text-[var(--color-muted)] uppercase">Where</p>
              <p className="text-[var(--color-ink)]">{invitee.venueName}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-[var(--color-muted)] uppercase">For</p>
            <p className="text-[var(--color-ink)]">{invitee.contactDisplayName}</p>
          </div>
        </div>

        {invitee.currentStatus !== 'invited' && (
          <div className="bg-[var(--color-paper)] border border-[var(--color-border)] rounded-lg p-3 text-sm">
            Your previous response: <strong>{invitee.currentStatus}</strong>. You can change it below.
          </div>
        )}

        <RsvpForm token={token} />

        <p className="text-xs text-[var(--color-muted)] border-t border-[var(--color-border)] pt-4">
          Sent via Lyra Convene. We&apos;ll let the host know your response right away. Your details aren&apos;t shared with other invitees.
        </p>
      </div>
    </main>
  );
}

function errorPage(message: string, hint?: string) {
  return (
    <main className="min-h-screen bg-[var(--color-paper)] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-xl border border-[var(--color-border)] p-8 text-center">
        <h1 className="text-xl font-medium text-[var(--color-ink)]">{message}</h1>
        {hint && <p className="text-sm text-[var(--color-muted)] mt-2">{hint}</p>}
      </div>
    </main>
  );
}
