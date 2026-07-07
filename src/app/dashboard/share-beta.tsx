'use client';

import { useState } from 'react';

/**
 * KAN-337 / KAN-349 — shareable link card (used by W5 + the standing beta share).
 *
 * Defaults render the original "Share beta access" widget verbatim (used while
 * the waitlist is in place — the link carries the skip-the-waitlist code). The
 * same layout is reused for the post-waitlist version by passing a different
 * title/description/link (e.g. a plain sign-up link once the gate is removed),
 * so the wording/layout the founder likes is preserved, not overwritten.
 */
export default function ShareBeta({
  inviteLink,
  title = 'Share beta access',
  description = 'Lyra is invite-only right now. Send this link to someone you’d like to bring in — it skips the waitlist and drops them straight into the beta.',
  linkLabel = 'Beta invite link',
  bare = false,
}: {
  inviteLink: string;
  title?: string;
  description?: string;
  linkLabel?: string;
  /** KAN-349: drop the outer card so it can be embedded in the W5 widget shell. */
  bare?: boolean;
}) {
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
    <div className={bare ? '' : 'bg-white rounded-xl border border-[var(--color-border)] p-6 mt-6'}>
      <h3 className="text-lg font-medium text-[var(--color-ink)] mb-1">{title}</h3>
      <p className="text-sm text-[var(--color-muted)] mb-4">{description}</p>

      <label htmlFor="share-link-input" className="sr-only">
        {linkLabel}
      </label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          id="share-link-input"
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
