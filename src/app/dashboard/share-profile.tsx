'use client';

import { useState } from 'react';
import { buildInviteText } from '@/lib/invite-text';

/**
 * KAN-154-B: client component for the dashboard "Share your invite" card.
 *
 * Renders a textarea pre-filled with the invite message (so the user can
 * tweak the greeting before copying) and a Copy button that writes the
 * current textarea contents to the clipboard. Two-second "Copied!" toast
 * gives feedback without library overhead.
 *
 * The textarea is the source of truth — `buildInviteText` only seeds the
 * initial value. This means edits the user makes locally before clicking
 * Copy are preserved in the clipboard write.
 *
 * Accessibility:
 *   - Textarea has a real label
 *   - Copy button has aria-live region for the success message
 *   - Falls back to a manual "select all" hint if clipboard API is
 *     unavailable (older browsers, file:// contexts)
 */
export default function ShareProfile({
  profileUrl,
  displayName,
}: {
  profileUrl?: string | null;
  displayName?: string | null;
}) {
  const initialText = buildInviteText({
    profileUrl,
    greeting: displayName ? `Hi! It's ${displayName}.` : undefined,
  });

  const [text, setText] = useState(initialText);
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  async function handleCopy() {
    try {
      // Modern path — works in all green-padlock contexts (HTTPS / localhost).
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setStatus('copied');
        setTimeout(() => setStatus('idle'), 2000);
        return;
      }
      setStatus('error');
    } catch {
      // Clipboard write can throw e.g. on focus-loss or permission-denied.
      // We don't surface the raw error — the user just needs to know to
      // copy manually.
      setStatus('error');
    }
  }

  return (
    <div className="mt-6 pt-6 border-t border-[var(--color-border)]">
      <h3 className="text-lg font-medium text-[var(--color-ink)] mb-1">
        Share Lyra with a friend
      </h3>
      <p className="text-sm text-[var(--color-muted)] mb-4">
        Tweak the message below if you like, then copy and paste it
        wherever feels right — WhatsApp, text, email.
      </p>

      <label htmlFor="invite-text" className="sr-only">
        Invite message
      </label>
      <textarea
        id="invite-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={7}
        className="w-full p-3 text-sm rounded-lg border border-[var(--color-border)] bg-white text-[var(--color-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--color-lyra-sage)] focus:border-transparent resize-y"
      />

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={handleCopy}
          className="px-5 py-2.5 rounded-full bg-[var(--color-lyra-sage)] text-white text-sm font-medium hover:bg-[var(--color-lyra-sage-hover)] transition-colors"
        >
          Copy message
        </button>
        <span
          role="status"
          aria-live="polite"
          className="text-sm text-[var(--color-muted)]"
        >
          {status === 'copied' && 'Copied!'}
          {status === 'error' &&
            'Copy not available — select the text and copy manually.'}
        </span>
      </div>
    </div>
  );
}
