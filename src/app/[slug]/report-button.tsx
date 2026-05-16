'use client';

import { useState } from 'react';
import Link from 'next/link';

/**
 * KAN-141: inline "Report this profile" button for the public profile page.
 *
 * Opens a small modal with reason dropdown + optional note. On submit
 * POSTs to /api/reports. Anonymous viewers see "Sign in to report" (no
 * client-side fetch — anonymous reporting is too easy to abuse and the
 * API rejects it anyway, but failing softly here is friendlier than a
 * 401 in DevTools).
 *
 * Three failure modes are surfaced to the user:
 *   - 401  — sign in required
 *   - 429  — already reported this profile recently (24h rate limit)
 *   - 4xx/5xx other — generic "something went wrong"
 */

const REASONS = [
  { value: 'spam', label: 'Spam or fake' },
  { value: 'harassment', label: 'Harassment or abuse' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'inappropriate', label: 'Inappropriate content' },
  { value: 'other', label: 'Something else' },
] as const;

type Status = 'idle' | 'submitting' | 'success' | 'error' | 'rate-limited' | 'unauthorized';

export default function ReportButton({
  profileSlug,
  isAuthenticated,
}: {
  profileSlug: string;
  isAuthenticated: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<typeof REASONS[number]['value']>('spam');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function resetAndClose() {
    setOpen(false);
    setStatus('idle');
    setNote('');
    setReason('spam');
    setErrorMessage(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isAuthenticated) {
      setStatus('unauthorized');
      return;
    }
    setStatus('submitting');
    setErrorMessage(null);

    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileSlug,
          reason,
          note: note.trim() || null,
        }),
      });

      if (res.status === 201) {
        setStatus('success');
      } else if (res.status === 401) {
        setStatus('unauthorized');
      } else if (res.status === 429) {
        setStatus('rate-limited');
      } else {
        setStatus('error');
        const body = await res.json().catch(() => null);
        setErrorMessage(body?.detail ?? body?.error ?? 'Unknown error');
      }
    } catch {
      setStatus('error');
      setErrorMessage('Network error — please try again later.');
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-stone-500 hover:text-stone-700 underline underline-offset-2 transition-colors"
      >
        Report this profile
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) resetAndClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-lg max-w-md w-full p-6">
        <h2 id="report-dialog-title" className="text-lg font-medium text-[var(--color-ink)] mb-1">
          Report this profile
        </h2>
        <p className="text-sm text-[var(--color-muted)] mb-5">
          A moderator will review your report. False reports may affect your account.
        </p>

        {status === 'success' ? (
          <div>
            <p className="text-sm text-[var(--color-ink)] mb-4">
              Thanks — your report has been filed.
            </p>
            <button
              type="button"
              onClick={resetAndClose}
              className="px-5 py-2.5 rounded-full bg-[var(--color-lyra-sage)] text-white text-sm font-medium hover:bg-[var(--color-lyra-sage-hover)] transition-colors"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="report-reason" className="block text-sm text-[var(--color-ink)] mb-1">
                Reason
              </label>
              <select
                id="report-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value as typeof reason)}
                className="w-full p-2 text-sm rounded-lg border border-stone-300 bg-white"
              >
                {REASONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="report-note" className="block text-sm text-[var(--color-ink)] mb-1">
                Note (optional)
              </label>
              <textarea
                id="report-note"
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 500))}
                rows={3}
                placeholder="Anything that would help the moderator?"
                className="w-full p-2 text-sm rounded-lg border border-stone-300 bg-white resize-y"
              />
              <p className="text-xs text-stone-500 mt-1">{note.length} / 500</p>
            </div>

            {status === 'unauthorized' && (
              <p className="text-sm text-amber-700 bg-amber-50 p-3 rounded-lg">
                Please <Link href="/login" className="underline">sign in</Link> to file a report.
              </p>
            )}
            {status === 'rate-limited' && (
              <p className="text-sm text-amber-700 bg-amber-50 p-3 rounded-lg">
                You&rsquo;ve already reported this profile in the last 24 hours.
              </p>
            )}
            {status === 'error' && (
              <p className="text-sm text-red-700 bg-red-50 p-3 rounded-lg">
                {errorMessage ?? 'Something went wrong. Please try again.'}
              </p>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={resetAndClose}
                className="text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={status === 'submitting'}
                className="px-5 py-2.5 rounded-full bg-[var(--color-lyra-sage)] text-white text-sm font-medium hover:bg-[var(--color-lyra-sage-hover)] transition-colors disabled:opacity-60"
              >
                {status === 'submitting' ? 'Submitting…' : 'Submit report'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
