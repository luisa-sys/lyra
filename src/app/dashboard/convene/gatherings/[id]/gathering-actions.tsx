'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { GatheringStatus, GatheringTransition } from '@/lib/convene/gatherings/state-machine';
import { addToHostCalendar, cancelGathering } from './actions';

interface Props {
  gatheringId: string;
  status: GatheringStatus;
  transitions: GatheringTransition[];
  calendarAdded: boolean;
}

export function GatheringActions({ gatheringId, status, transitions, calendarAdded }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const canCancel = transitions.includes('cancel');
  const canAddToCalendar = status === 'live' && !calendarAdded;

  async function handleAddToCalendar() {
    if (!confirm('Add this gathering to your connected Google Calendar?')) return;
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await addToHostCalendar(gatheringId);
      if (result.ok) {
        setSuccess('Added to your calendar.');
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  async function handleCancel() {
    if (!confirm('Cancel this gathering? This will be visible in the audit log; invitees won\'t be notified automatically in this version.')) return;
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await cancelGathering(gatheringId);
      if (result.ok) {
        setSuccess('Gathering cancelled.');
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  if (!canCancel && !canAddToCalendar) return null;

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-6">
      <h2 className="text-lg font-medium text-[var(--color-ink)] mb-3">Actions</h2>
      <div className="flex flex-wrap gap-2">
        {canAddToCalendar && (
          <button
            type="button"
            onClick={handleAddToCalendar}
            disabled={pending}
            className="px-4 py-2 rounded-lg bg-[var(--color-sage)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {pending ? 'Working…' : '+ Add to my Google Calendar'}
          </button>
        )}
        {canCancel && (
          <button
            type="button"
            onClick={handleCancel}
            disabled={pending}
            className="px-4 py-2 rounded-lg border border-rose-300 text-rose-700 text-sm font-medium hover:bg-rose-50 disabled:opacity-50"
          >
            {pending ? 'Working…' : 'Cancel gathering'}
          </button>
        )}
      </div>
      {error && (
        <div className="mt-3 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-sm text-rose-900">
          {error}
        </div>
      )}
      {success && (
        <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-sm text-emerald-900">
          {success}
        </div>
      )}
    </div>
  );
}
