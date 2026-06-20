/**
 * /dashboard/convene/gatherings — KAN-236 (Convene P4 UI).
 *
 * Lists the host's gatherings. Status badge, type, finalised slot or target
 * window, invitee count, venue (if any). Links into the detail page.
 */

import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { isConveneEnabled } from '@/lib/convene/flags';

export const metadata = {
  title: 'Convene Gatherings — Lyra',
  description: 'Your AI-orchestrated gatherings.',
};

interface GatheringRow {
  id: string;
  title: string;
  gathering_type: string;
  status: string;
  target_window_start: string | null;
  finalised_slot_start: string | null;
  finalised_slot_end: string | null;
  venue_id: string | null;
  created_at: string;
  invitee_count: { count: number }[] | null;
  venue: { name: string; city: string | null } | null;
}

const STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: 'bg-[#f4efe7] text-[var(--color-ink)] border-[var(--color-border)]' },
  awaiting_responses: { label: 'Awaiting RSVPs', tone: 'bg-amber-50 text-amber-900 border-amber-200' },
  live: { label: 'Live', tone: 'bg-emerald-50 text-emerald-900 border-emerald-200' },
  rescheduled: { label: 'Rescheduled', tone: 'bg-sky-50 text-sky-900 border-sky-200' },
  cancelled: { label: 'Cancelled', tone: 'bg-[#f4efe7] text-[var(--color-muted)] border-[var(--color-border)]' },
  completed: { label: 'Completed', tone: 'bg-[var(--color-paper)] text-[var(--color-muted)] border-[var(--color-border)]' },
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function GatheringsListPage() {
  if (!isConveneEnabled()) {
    return (
      <main className="min-h-screen bg-[var(--color-paper)] flex items-center justify-center">
        <p className="text-[var(--color-muted)]">Convene is not enabled.</p>
      </main>
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/dashboard/convene/gatherings');

  const { data: gatherings } = await supabase
    .from('gatherings')
    .select(`
      id, title, gathering_type, status,
      target_window_start, finalised_slot_start, finalised_slot_end,
      venue_id, created_at,
      invitee_count:gathering_invitees(count),
      venue:venues(name, city)
    `)
    .eq('host_user_id', user.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(50);

  const rows = (gatherings ?? []) as unknown as GatheringRow[];

  return (
    <main className="min-h-screen bg-[var(--color-paper)]">
      <header className="border-b border-[var(--color-border)] bg-white">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center">
            <Image src="/lyra-logo.png" alt="Lyra" width={32} height={32} className="h-8 w-auto" />
          </Link>
          <span className="text-sm text-[var(--color-muted)]">Convene Gatherings</span>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-medium text-[var(--color-ink)]">Gatherings</h1>
          <p className="text-[var(--color-muted)] mt-1">
            What you (or your AI agent) have set in motion. Talk to Lyra in any MCP client to create new ones — the dashboard is for review and action.
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="bg-white rounded-xl border border-[var(--color-border)] p-8 text-center">
            <h2 className="text-lg font-medium text-[var(--color-ink)]">No gatherings yet</h2>
            <p className="text-sm text-[var(--color-muted)] mt-2 max-w-md mx-auto">
              Ask Lyra in any MCP client: <em>&ldquo;Lyra, create a draft coffee gathering for next Saturday&rdquo;</em>. It&apos;ll appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((g) => {
              const tone = STATUS_LABELS[g.status] ?? { label: g.status, tone: 'bg-[#f4efe7]' };
              const slot = g.finalised_slot_start
                ? `${formatDate(g.finalised_slot_start)} → ${new Date(g.finalised_slot_end!).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
                : g.target_window_start
                  ? `Aiming for ${formatDate(g.target_window_start)}`
                  : 'No time set yet';
              const venueText = g.venue
                ? `${g.venue.name}${g.venue.city ? ` — ${g.venue.city}` : ''}`
                : null;
              const inviteeCount = g.invitee_count?.[0]?.count ?? 0;

              return (
                <Link
                  key={g.id}
                  href={`/dashboard/convene/gatherings/${g.id}`}
                  className="block bg-white rounded-xl border border-[var(--color-border)] p-5 hover:border-[var(--color-border)] transition"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`inline-block px-2 py-0.5 rounded-md border text-xs font-medium ${tone.tone}`}>
                          {tone.label}
                        </span>
                        <span className="text-xs text-[var(--color-muted)]">{g.gathering_type}</span>
                      </div>
                      <h3 className="text-base font-medium text-[var(--color-ink)] truncate">{g.title}</h3>
                      <p className="text-sm text-[var(--color-muted)] mt-1">{slot}</p>
                      {venueText && <p className="text-sm text-[var(--color-muted)]">📍 {venueText}</p>}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-[var(--color-muted)]">
                        {inviteeCount} {inviteeCount === 1 ? 'invitee' : 'invitees'}
                      </p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        <div className="text-sm text-[var(--color-muted)]">
          <Link href="/dashboard" className="text-[var(--color-sage)] hover:underline">← Back to dashboard</Link>
          <span className="mx-2">·</span>
          <Link href="/dashboard/convene/connections" className="text-[var(--color-sage)] hover:underline">Calendar connections</Link>
        </div>
      </div>
    </main>
  );
}
