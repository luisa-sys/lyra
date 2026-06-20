/**
 * /dashboard/convene/gatherings/[id] — KAN-236 (Convene P4 UI).
 *
 * Detail view: status, slot, venue, invitees, proposed slots, audit log.
 * Action buttons gated by state-machine transitions:
 *   - "Add to my calendar" when status=live and not yet added
 *   - "Cancel gathering" when in any non-terminal state
 * Buttons call server actions in ./actions.ts.
 */

import { createClient } from '@/lib/supabase-server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { isConveneEnabled } from '@/lib/convene/flags';
import {
  availableTransitions,
  type GatheringStatus,
} from '@/lib/convene/gatherings/state-machine';
import { GatheringActions } from './gathering-actions';

interface InviteeRow {
  id: string;
  status: string;
  invited_at: string | null;
  responded_at: string | null;
  contact: { display_name: string; city: string | null } | null;
}

interface SlotRow {
  id: string;
  slot_start: string;
  slot_end: string;
  score: number | null;
}

interface EventRow {
  id: string;
  event_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface VenueRow {
  id: string;
  name: string;
  venue_type: string;
  city: string | null;
  postcode: string | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

const STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: 'bg-[#f4efe7] text-[var(--color-ink)] border-[var(--color-border)]' },
  awaiting_responses: { label: 'Awaiting RSVPs', tone: 'bg-amber-50 text-amber-900 border-amber-200' },
  live: { label: 'Live', tone: 'bg-emerald-50 text-emerald-900 border-emerald-200' },
  rescheduled: { label: 'Rescheduled', tone: 'bg-sky-50 text-sky-900 border-sky-200' },
  cancelled: { label: 'Cancelled', tone: 'bg-[#f4efe7] text-[var(--color-muted)] border-[var(--color-border)]' },
  completed: { label: 'Completed', tone: 'bg-[var(--color-paper)] text-[var(--color-muted)] border-[var(--color-border)]' },
};

export default async function GatheringDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isConveneEnabled()) {
    return (
      <main className="min-h-screen bg-[var(--color-paper)] flex items-center justify-center">
        <p className="text-[var(--color-muted)]">Convene is not enabled.</p>
      </main>
    );
  }

  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/dashboard/convene/gatherings/${id}`);

  const { data: g } = await supabase
    .from('gatherings')
    .select('*')
    .eq('id', id)
    .eq('host_user_id', user.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!g) notFound();

  const [invitees, slots, events, venue, calendarAdded] = await Promise.all([
    supabase
      .from('gathering_invitees')
      .select('id, status, invited_at, responded_at, contact:contacts(display_name, city)')
      .eq('gathering_id', id)
      .order('invited_at', { ascending: true, nullsFirst: true })
      .then((r) => (r.data as unknown as InviteeRow[]) ?? []),
    supabase
      .from('gathering_proposed_slots')
      .select('id, slot_start, slot_end, score')
      .eq('gathering_id', id)
      .order('score', { ascending: false, nullsFirst: false })
      .then((r) => (r.data as SlotRow[]) ?? []),
    supabase
      .from('gathering_events_log')
      .select('id, event_type, metadata, created_at')
      .eq('gathering_id', id)
      .order('created_at', { ascending: false })
      .limit(20)
      .then((r) => (r.data as EventRow[]) ?? []),
    g.venue_id
      ? supabase.from('venues').select('id, name, venue_type, city, postcode').eq('id', g.venue_id).maybeSingle().then((r) => r.data as VenueRow | null)
      : Promise.resolve<VenueRow | null>(null),
    supabase
      .from('gathering_events_log')
      .select('id')
      .eq('gathering_id', id)
      .eq('event_type', 'calendar_event_added')
      .limit(1)
      .then((r) => (r.data?.length ?? 0) > 0),
  ]);

  const tone = STATUS_LABELS[g.status as string] ?? { label: g.status, tone: 'bg-[#f4efe7]' };
  const transitions = availableTransitions(g.status as GatheringStatus);

  return (
    <main className="min-h-screen bg-[var(--color-paper)]">
      <header className="border-b border-[var(--color-border)] bg-white">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center">
            <Image src="/lyra-logo.png" alt="Lyra" width={32} height={32} className="h-8 w-auto" />
          </Link>
          <span className="text-sm text-[var(--color-muted)]">Gathering Detail</span>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div>
          <Link href="/dashboard/convene/gatherings" className="text-sm text-[var(--color-sage)] hover:underline">
            ← All gatherings
          </Link>
        </div>

        <div className="bg-white rounded-xl border border-[var(--color-border)] p-6">
          <div className="flex items-center gap-2 mb-2">
            <span className={`inline-block px-2 py-0.5 rounded-md border text-xs font-medium ${tone.tone}`}>
              {tone.label}
            </span>
            <span className="text-xs text-[var(--color-muted)]">{g.gathering_type as string}</span>
          </div>
          <h1 className="text-2xl font-medium text-[var(--color-ink)]">{g.title as string}</h1>
          {g.description && <p className="text-[var(--color-muted)] mt-2">{g.description as string}</p>}
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-[var(--color-muted)] uppercase">When</p>
              <p className="text-[var(--color-ink)]">
                {g.finalised_slot_start
                  ? `${fmtDate(g.finalised_slot_start as string)} → ${new Date(g.finalised_slot_end as string).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
                  : g.target_window_start
                    ? `Aiming for ${fmtDate(g.target_window_start as string)}`
                    : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--color-muted)] uppercase">Where</p>
              <p className="text-[var(--color-ink)]">
                {venue ? `${venue.name}${venue.city ? ` — ${venue.city}` : ''}` : '— not set —'}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--color-muted)] uppercase">Capacity</p>
              <p className="text-[var(--color-ink)]">
                {g.capacity_min ?? '?'} – {g.capacity_max ?? '?'}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--color-muted)] uppercase">Created</p>
              <p className="text-[var(--color-ink)]">{fmtDate(g.created_at as string)}</p>
            </div>
          </div>
          {g.notes && (
            <div className="mt-4">
              <p className="text-xs text-[var(--color-muted)] uppercase">Host notes</p>
              <p className="text-sm text-[var(--color-ink)] whitespace-pre-wrap">{g.notes as string}</p>
            </div>
          )}
        </div>

        <GatheringActions
          gatheringId={id}
          status={g.status as GatheringStatus}
          transitions={transitions}
          calendarAdded={calendarAdded}
        />

        {invitees.length > 0 && (
          <div className="bg-white rounded-xl border border-[var(--color-border)] p-6">
            <h2 className="text-lg font-medium text-[var(--color-ink)] mb-3">Invitees ({invitees.length})</h2>
            <ul className="space-y-2">
              {invitees.map((i) => (
                <li key={i.id} className="flex items-center justify-between text-sm">
                  <span className="text-[var(--color-ink)]">
                    {i.contact?.display_name ?? '(unknown)'}
                    {i.contact?.city && <span className="text-[var(--color-muted)]"> — {i.contact.city}</span>}
                  </span>
                  <span className="text-xs text-[var(--color-muted)]">{i.status}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {slots.length > 0 && g.status === 'draft' && (
          <div className="bg-white rounded-xl border border-[var(--color-border)] p-6">
            <h2 className="text-lg font-medium text-[var(--color-ink)] mb-3">Proposed slots</h2>
            <ul className="space-y-1 text-sm">
              {slots.map((s) => (
                <li key={s.id} className="flex justify-between text-[var(--color-ink)]">
                  <span>{fmtDate(s.slot_start)} → {new Date(s.slot_end).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                  {s.score != null && <span className="text-xs text-[var(--color-muted)]">score {s.score.toFixed(2)}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="bg-white rounded-xl border border-[var(--color-border)] p-6">
          <h2 className="text-lg font-medium text-[var(--color-ink)] mb-3">Activity</h2>
          <ul className="space-y-1.5 text-sm">
            {events.length === 0 ? (
              <li className="text-[var(--color-muted)]">No activity yet</li>
            ) : (
              events.map((e) => (
                <li key={e.id} className="text-[var(--color-muted)]">
                  <span className="font-mono text-xs">{new Date(e.created_at).toLocaleString('en-GB')}</span>
                  <span className="mx-2">·</span>
                  <span className="text-[var(--color-ink)]">{e.event_type}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </main>
  );
}
