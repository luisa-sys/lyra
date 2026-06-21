'use client';

/**
 * SEC-18 (F-07) — calendar busy-time sharing opt-in toggle.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setAvailabilitySharing } from './availability-actions';

export function AvailabilityToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    const next = !on;
    setError(null);
    startTransition(async () => {
      const res = await setAvailabilitySharing(next);
      if (res.ok) {
        setOn(next);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="bg-white rounded-xl border border-[var(--color-border)] p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium text-[var(--color-ink)]">Share my availability</h2>
          <p className="text-sm text-[var(--color-muted)] mt-1">
            When on, people who’ve added you as a contact can see your <strong>busy/free</strong> windows
            (never event details) while organising — so they can pick a time that works. Off by default.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Share my availability with contacts"
          disabled={pending}
          onClick={toggle}
          className={`shrink-0 mt-1 inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
            on ? 'bg-[var(--color-sage)]' : 'bg-[var(--color-border)]'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
              on ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}
    </div>
  );
}
