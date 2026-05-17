'use client';

import { useState, useTransition } from 'react';
import { submitRsvp } from './actions';

export function RsvpForm({ token }: { token: string }) {
  const [pending, startTransition] = useTransition();
  const [submitted, setSubmitted] = useState<'accepted' | 'declined' | 'tentative' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');

  async function handle(status: 'accepted' | 'declined' | 'tentative') {
    setError(null);
    startTransition(async () => {
      const res = await submitRsvp(token, status, note);
      if (res.ok) {
        setSubmitted(status);
      } else {
        setError(res.error);
      }
    });
  }

  if (submitted) {
    return (
      <div className={`rounded-lg p-4 text-center ${submitted === 'accepted' ? 'bg-emerald-50 border border-emerald-200 text-emerald-900' : submitted === 'declined' ? 'bg-stone-100 border border-stone-200 text-stone-700' : 'bg-amber-50 border border-amber-200 text-amber-900'}`}>
        <p className="font-medium">Thanks — your response is recorded.</p>
        <p className="text-sm mt-1">You said: <strong>{submitted}</strong></p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-sm text-rose-900">
          {error}
        </div>
      )}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value.slice(0, 500))}
        placeholder="Anything to add (dietary needs, plus-one, can't make it but want to know next time)?"
        rows={2}
        maxLength={500}
        className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm placeholder-stone-400 focus:outline-none focus:border-stone-500"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => handle('accepted')}
          className="flex-1 px-4 py-2.5 rounded-lg bg-[var(--color-sage)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          Yes, I&apos;ll be there
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => handle('tentative')}
          className="flex-1 px-4 py-2.5 rounded-lg border border-stone-300 text-[var(--color-ink)] text-sm font-medium hover:bg-stone-50 disabled:opacity-50"
        >
          Maybe
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => handle('declined')}
          className="flex-1 px-4 py-2.5 rounded-lg border border-stone-300 text-[var(--color-ink)] text-sm font-medium hover:bg-stone-50 disabled:opacity-50"
        >
          Can&apos;t make it
        </button>
      </div>
    </div>
  );
}
