'use client';

/**
 * KAN-306 — finalise + invite-management client island for the gathering
 * detail page.
 *
 *   FinalisePanel — pick one of the proposed slots and lock the gathering
 *     (draft → live) via finaliseGathering.
 *   InviteManager — "Send invites" (queues + drains, shows a summary) plus a
 *     per-invitee surface (RSVP status, delivery status, resend, cancel).
 *
 * Mutations call the server actions in ./actions and router.refresh()
 * (the established convene convention).
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { finaliseGathering, sendInvites, resendInvite, cancelInvite } from './actions';

const primaryBtn =
  'px-4 py-2 rounded-lg bg-[var(--color-sage)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50';
const secondaryBtn =
  'px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-ink)] hover:bg-[var(--color-paper)] disabled:opacity-50';
const dangerBtn =
  'px-3 py-1.5 rounded-lg border border-rose-300 text-rose-700 text-sm hover:bg-rose-50 disabled:opacity-50';

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

export interface ProposedSlot {
  id: string;
  slot_start: string;
  slot_end: string;
}

export function FinalisePanel({ gatheringId, slots }: { gatheringId: string; slots: ProposedSlot[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string>(slots[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);

  function finalise() {
    const slot = slots.find((s) => s.id === selected);
    if (!slot) {
      setError('Pick a time to lock in.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await finaliseGathering(gatheringId, slot.slot_start, slot.slot_end);
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  return (
    <div className="bg-white rounded-xl border border-[var(--color-border)] p-6">
      <h2 className="text-lg font-medium text-[var(--color-ink)] mb-1">Lock in a time</h2>
      <p className="text-sm text-[var(--color-muted)] mb-3">
        Choose one of your proposed times to finalise this gathering. You can then send invites.
      </p>
      {error && (
        <div className="mb-3 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-sm text-rose-900">{error}</div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm bg-white"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          {slots.map((s) => (
            <option key={s.id} value={s.id}>
              {fmt(s.slot_start)} → {new Date(s.slot_end).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            </option>
          ))}
        </select>
        <button type="button" className={primaryBtn} disabled={pending || !selected} onClick={finalise}>
          {pending ? 'Finalising…' : 'Finalise'}
        </button>
      </div>
    </div>
  );
}

export interface InviteeView {
  id: string;
  displayName: string;
  city: string | null;
  status: string;
  deliveryStatus: string | null;
}

const RSVP_TONE: Record<string, string> = {
  accepted: 'text-emerald-700',
  declined: 'text-rose-700',
  tentative: 'text-amber-700',
  cancelled: 'text-[var(--color-muted)]',
};

export function InviteManager({
  gatheringId,
  canSend,
  invitees,
}: {
  gatheringId: string;
  canSend: boolean;
  invitees: InviteeView[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, onOk?: () => void) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        onOk?.();
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  function send() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await sendInvites(gatheringId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const s = res.summary;
      const parts = [`Queued ${s.queued}`, `sent ${s.sent}`];
      if (s.blocked_by_allowlist > 0) parts.push(`${s.blocked_by_allowlist} held by the invite allow-list`);
      if (s.failed > 0) parts.push(`${s.failed} failed`);
      setNotice(parts.join(' · '));
      router.refresh();
    });
  }

  return (
    <div className="bg-white rounded-xl border border-[var(--color-border)] p-6">
      <div className="flex items-center justify-between mb-3 gap-3">
        <h2 className="text-lg font-medium text-[var(--color-ink)]">Invitees ({invitees.length})</h2>
        {canSend && (
          <button type="button" className={primaryBtn} disabled={pending} onClick={send}>
            {pending ? 'Sending…' : 'Send invites'}
          </button>
        )}
      </div>

      {!canSend && (
        <p className="text-xs text-[var(--color-muted)] mb-3">
          Finalise a time (above) to enable sending invites.
        </p>
      )}
      {error && (
        <div className="mb-3 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-sm text-rose-900">{error}</div>
      )}
      {notice && (
        <div className="mb-3 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-sm text-emerald-900">
          {notice}
        </div>
      )}

      <ul className="space-y-2">
        {invitees.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-[var(--color-ink)]">
              {i.displayName}
              {i.city && <span className="text-[var(--color-muted)]"> — {i.city}</span>}
            </span>
            <div className="flex items-center gap-3">
              <span className={`text-xs ${RSVP_TONE[i.status] ?? 'text-[var(--color-muted)]'}`}>{i.status}</span>
              {i.deliveryStatus && (
                <span className="text-xs text-[var(--color-muted)]">· {i.deliveryStatus}</span>
              )}
              {i.status !== 'cancelled' && (
                <>
                  <button type="button" className={secondaryBtn} disabled={pending || !canSend} onClick={() => run(() => resendInvite(i.id))}>
                    Resend
                  </button>
                  <button
                    type="button"
                    className={dangerBtn}
                    disabled={pending}
                    onClick={() => {
                      if (confirm(`Cancel the invite for ${i.displayName}?`)) run(() => cancelInvite(i.id));
                    }}
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
