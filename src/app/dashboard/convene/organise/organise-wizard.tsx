'use client';

/**
 * KAN-305 — Organise-event wizard client island.
 *
 * Steps: people → details → time → venue → create. Produces a draft gathering
 * via createGatheringDraft, then routes to its detail page (where the host
 * finalises a slot + venue and sends invites — KAN-306). Venue is advisory
 * here (the draft has no venue until finalise); the wizard ranks the shared
 * catalogue with the real scoreVenue engine.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createGatheringDraft, getHostBusyTimes, suggestVenues } from './actions';
import {
  GATHERING_TYPES,
  GATHERING_TYPE_LABELS,
  MAX_PROPOSED_SLOTS,
  type BusyBlockView,
  type ProposedSlotInput,
  type VenueSuggestion,
} from './organise-fields';
import type { GatheringType } from '@/lib/recommend/convene/types';
import type { WizardContact } from './page';

const inputCls =
  'w-full px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-ink)] bg-white focus:outline-none focus:ring-1 focus:ring-[var(--color-sage)]';
const primaryBtn =
  'px-4 py-2 rounded-lg bg-[var(--color-sage)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50';
const secondaryBtn =
  'px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-ink)] hover:bg-[var(--color-paper)] disabled:opacity-50';

const STEPS = ['People', 'Details', 'Time', 'Venue', 'Create'];

function localToISO(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function fmt(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

interface SlotDraft {
  start: string; // datetime-local
  end: string;
}

export default function OrganiseWizard({
  contacts,
  preselectId,
}: {
  contacts: WizardContact[];
  preselectId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Step 1 — people
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(preselectId ? [preselectId] : [])
  );

  // Step 2 — details
  const [title, setTitle] = useState('');
  const [type, setType] = useState<GatheringType>('coffee');
  const [description, setDescription] = useState('');
  const [capacityMax, setCapacityMax] = useState('');
  const [dietary, setDietary] = useState('');
  const [notes, setNotes] = useState('');

  // Step 3 — time
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const [busy, setBusy] = useState<BusyBlockView[] | null>(null);
  const [busyNote, setBusyNote] = useState<string | null>(null);
  const [busyLoading, setBusyLoading] = useState(false);
  const [slots, setSlots] = useState<SlotDraft[]>([{ start: '', end: '' }]);

  // Step 4 — venue
  const [venues, setVenues] = useState<VenueSuggestion[] | null>(null);
  const [venueLoading, setVenueLoading] = useState(false);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function checkCalendar() {
    setError(null);
    const s = localToISO(windowStart);
    const e = localToISO(windowEnd);
    if (!s || !e) {
      setError('Pick a start and end for the window first.');
      return;
    }
    setBusyLoading(true);
    setBusy(null);
    setBusyNote(null);
    const res = await getHostBusyTimes(s, e);
    setBusyLoading(false);
    if (res.ok) {
      setBusy(res.busy);
      if (res.note) setBusyNote(res.note);
    } else {
      setError(res.error);
    }
  }

  async function loadVenues() {
    setError(null);
    setVenueLoading(true);
    const anchor = contacts.find((c) => selected.has(c.id))?.city ?? null;
    const res = await suggestVenues({ intent: type, anchor, capacityRequired: selected.size });
    setVenueLoading(false);
    if (res.ok) setVenues(res.venues);
    else setError(res.error);
  }

  function create() {
    setError(null);
    const proposed: ProposedSlotInput[] = [];
    for (const s of slots) {
      if (!s.start && !s.end) continue;
      const startIso = localToISO(s.start);
      const endIso = localToISO(s.end);
      if (!startIso || !endIso) {
        setError('One of your proposed times is incomplete.');
        return;
      }
      proposed.push({ slot_start_iso: startIso, slot_end_iso: endIso });
    }
    startTransition(async () => {
      const res = await createGatheringDraft({
        title: title.trim(),
        gathering_type: type,
        description: description.trim() || undefined,
        invitee_contact_ids: Array.from(selected),
        proposed_slots: proposed.slice(0, MAX_PROPOSED_SLOTS),
        target_window_start_iso: localToISO(windowStart) ?? undefined,
        target_window_end_iso: localToISO(windowEnd) ?? undefined,
        capacity_max: capacityMax ? Number(capacityMax) : undefined,
        dietary_summary: dietary.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      if (res.ok) router.push(`/dashboard/convene/gatherings/${res.gatheringId}`);
      else setError(res.error);
    });
  }

  const canCreate = title.trim().length > 0;

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap gap-2 text-xs">
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={`px-2 py-1 rounded-md border ${
              i === step
                ? 'bg-[var(--color-sage)] text-white border-[var(--color-sage)]'
                : 'border-[var(--color-border)] text-[var(--color-muted)]'
            }`}
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg px-4 py-3 text-sm text-rose-900">{error}</div>
      )}

      <div className="bg-white rounded-xl border border-[var(--color-border)] p-5 space-y-4">
        {step === 0 && (
          <div className="space-y-3">
            <h2 className="font-medium text-[var(--color-ink)]">Who would you like to invite?</h2>
            <ul className="space-y-2 max-h-80 overflow-auto">
              {contacts.map((c) => (
                <li key={c.id}>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                    <span className="text-sm text-[var(--color-ink)]">{c.display_name}</span>
                    {c.city && <span className="text-xs text-[var(--color-muted)]">· {c.city}</span>}
                    {c.has_linked_profile && (
                      <span className="text-xs text-[var(--color-muted)]">🔗</span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
            <p className="text-xs text-[var(--color-muted)]">{selected.size} selected</p>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <h2 className="font-medium text-[var(--color-ink)]">What’s the plan?</h2>
            <div>
              <label className="block text-sm text-[var(--color-muted)] mb-1">Title *</label>
              <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-[var(--color-muted)] mb-1">Type</label>
                <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as GatheringType)}>
                  {GATHERING_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {GATHERING_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-[var(--color-muted)] mb-1">Max people (optional)</label>
                <input
                  className={inputCls}
                  type="number"
                  min={0}
                  value={capacityMax}
                  onChange={(e) => setCapacityMax(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm text-[var(--color-muted)] mb-1">Description (optional)</label>
              <textarea className={inputCls} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
            </div>
            <div>
              <label className="block text-sm text-[var(--color-muted)] mb-1">Dietary notes (optional)</label>
              <input className={inputCls} value={dietary} onChange={(e) => setDietary(e.target.value)} maxLength={500} />
            </div>
            <div>
              <label className="block text-sm text-[var(--color-muted)] mb-1">Private notes (optional)</label>
              <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <h2 className="font-medium text-[var(--color-ink)]">When works?</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-[var(--color-muted)] mb-1">Window from</label>
                <input className={inputCls} type="datetime-local" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm text-[var(--color-muted)] mb-1">Window to</label>
                <input className={inputCls} type="datetime-local" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
              </div>
            </div>
            <button type="button" className={secondaryBtn} disabled={busyLoading} onClick={checkCalendar}>
              {busyLoading ? 'Checking…' : 'Check my calendar'}
            </button>
            {busyNote && <p className="text-xs text-[var(--color-muted)]">{busyNote}</p>}
            {busy && busy.length > 0 && (
              <div className="text-xs text-[var(--color-muted)]">
                <p className="mb-1">You’re busy during:</p>
                <ul className="space-y-0.5">
                  {busy.slice(0, 12).map((b, i) => (
                    <li key={i}>
                      {fmt(b.start)} – {fmt(b.end)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {busy && busy.length === 0 && <p className="text-xs text-[var(--color-muted)]">No busy times in that window.</p>}

            <div className="space-y-2 pt-2 border-t border-[var(--color-border)]">
              <p className="text-sm text-[var(--color-muted)]">Propose one or more times:</p>
              {slots.map((s, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2">
                  <input
                    className={inputCls + ' max-w-[14rem]'}
                    type="datetime-local"
                    value={s.start}
                    onChange={(e) => setSlots((prev) => prev.map((p, j) => (j === i ? { ...p, start: e.target.value } : p)))}
                  />
                  <span className="text-[var(--color-muted)]">→</span>
                  <input
                    className={inputCls + ' max-w-[14rem]'}
                    type="datetime-local"
                    value={s.end}
                    onChange={(e) => setSlots((prev) => prev.map((p, j) => (j === i ? { ...p, end: e.target.value } : p)))}
                  />
                  {slots.length > 1 && (
                    <button type="button" className={secondaryBtn} onClick={() => setSlots((prev) => prev.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  )}
                </div>
              ))}
              {slots.length < MAX_PROPOSED_SLOTS && (
                <button type="button" className={secondaryBtn} onClick={() => setSlots((prev) => [...prev, { start: '', end: '' }])}>
                  + Add another time
                </button>
              )}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <h2 className="font-medium text-[var(--color-ink)]">Somewhere to meet?</h2>
            <p className="text-xs text-[var(--color-muted)]">
              Suggestions are ranked for a {GATHERING_TYPE_LABELS[type].toLowerCase()} near your guests. You’ll lock a
              venue in when you finalise.
            </p>
            <button type="button" className={secondaryBtn} disabled={venueLoading} onClick={loadVenues}>
              {venueLoading ? 'Finding venues…' : 'Suggest venues'}
            </button>
            {venues && venues.length === 0 && (
              <p className="text-xs text-[var(--color-muted)]">
                No venues in the catalogue yet — your agent can search Google Places via Convene, or you can add one when
                finalising.
              </p>
            )}
            {venues && venues.length > 0 && (
              <ul className="space-y-2">
                {venues.map((v) => (
                  <li key={v.venueId} className="text-sm">
                    <span className="text-[var(--color-ink)]">{v.name}</span>
                    <span className="text-[var(--color-muted)]">
                      {' '}· {v.venueType}
                      {v.city ? ` · ${v.city}` : ''} · {Math.round(v.score * 100)}% fit
                    </span>
                    {v.reasons.length > 0 && (
                      <span className="block text-xs text-[var(--color-muted)]">{v.reasons.join(' · ')}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3">
            <h2 className="font-medium text-[var(--color-ink)]">Ready to create the draft?</h2>
            <ul className="text-sm text-[var(--color-muted)] space-y-1">
              <li>
                <strong className="text-[var(--color-ink)]">{title.trim() || 'Untitled'}</strong> · {GATHERING_TYPE_LABELS[type]}
              </li>
              <li>{selected.size} {selected.size === 1 ? 'person' : 'people'} invited</li>
              <li>{slots.filter((s) => s.start && s.end).length} proposed time(s)</li>
            </ul>
            <p className="text-xs text-[var(--color-muted)]">
              We’ll create a draft you can review, finalise, and send invites from.
            </p>
          </div>
        )}
      </div>

      <div className="flex justify-between">
        <button type="button" className={secondaryBtn} disabled={step === 0 || pending} onClick={() => setStep((s) => Math.max(0, s - 1))}>
          Back
        </button>
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            className={primaryBtn}
            disabled={step === 1 && !title.trim()}
            onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
          >
            Next
          </button>
        ) : (
          <button type="button" className={primaryBtn} disabled={!canCreate || pending} onClick={create}>
            {pending ? 'Creating…' : 'Create draft'}
          </button>
        )}
      </div>
    </div>
  );
}
