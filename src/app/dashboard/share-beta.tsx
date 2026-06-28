'use client';

import { useState } from 'react';

/**
 * KAN-337 — standalone "Share beta access" card.
 *
 * Shows the beta-invite deep-link (`/join?code=…`) with a one-click copy. The
 * link carries the skip-the-waitlist code, so anyone the user shares it with
 * lands on sign-up and goes straight into the beta. Shown on the dashboard only
 * when LYRA_INVITE_CODE is configured (the parent passes a non-null link).
 */
export default function ShareBeta({ inviteLink }: { inviteLink: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  async function handleCopy() {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(inviteLink);
        setStatus('copied');
        setTimeout(() => setStatus('idle'), 2000);
        return;
      }
      setStatus('error');
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className="bg-white rounded-xl border border-[var(--color-border)] p-6 mt-6">
      <h3 className="text-lg font-medium text-[var(--color-ink)] mb-1">Share beta access</h3>
      <p className="text-sm text-[var(--color-muted)] mb-4">
        Lyra is invite-only right now. Send this link to someone you&rsquo;d like to bring in — it
        skips the waitlist and drops them straight into the beta.
      </p>

      <label htmlFor="beta-invite-link" className="sr-only">
        Beta invite link
      </label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          id="beta-invite-link"
          type="text"
          readOnly
          value={inviteLink}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 px-3 py-2.5 text-sm rounded-lg border border-[var(--color-border)] bg-[#faf8f4] text-[var(--color-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)]"
        />
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 px-5 py-2.5 rounded-lg bg-[var(--color-sage)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Copy link
        </button>
      </div>

      <span role="status" aria-live="polite" className="mt-2 block text-sm text-[var(--color-muted)]">
        {status === 'copied' && 'Copied! Paste it into a message.'}
        {status === 'error' && 'Copy not available — select the link and copy manually.'}
      </span>
    </div>
  );
}
