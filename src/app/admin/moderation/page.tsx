/**
 * KAN-309 / KAN-313: moderation review queue.
 *
 * One triage view over the two things the platform already captures:
 *   1. Pending user `reports` (KAN-141) — link into the existing per-report
 *      action page at /admin/reports/[id].
 *   2. Recent `content_moderation_flags` (KAN-244) — the warn/block hits the
 *      moderation library records on profile/Convene writes.
 *
 * v1 is read-only triage: flags have no review-state column yet (follow-up
 * KAN-313), so each flag links through to the user where the admin acts with
 * the existing suspend / delete tooling. `content_moderation_flags.profile_id`
 * has no FK to profiles, so we resolve slugs in a second query and map.
 */

import Link from 'next/link';
import { getAdminServiceClient } from '@/lib/admin';

export const dynamic = 'force-dynamic';

interface ReportRow {
  id: string;
  reason: string;
  status: string;
  note: string | null;
  created_at: string;
  profile: { slug: string; display_name: string } | null;
}

interface FlagRow {
  id: string;
  profile_id: string | null;
  field: string;
  severity: string;
  flags: string[] | null;
  content_snippet: string | null;
  source: string | null;
  created_at: string;
}

async function loadPendingReports(): Promise<ReportRow[]> {
  const svc = getAdminServiceClient();
  const { data } = await svc
    .from('reports')
    .select('id, reason, status, note, created_at, profile:profiles!reports_profile_id_fkey(slug, display_name)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(100);
  return ((data ?? []) as unknown as ReportRow[]).map((r) => {
    const cand = r.profile as unknown;
    const profile = Array.isArray(cand) ? (cand[0] ?? null) : cand;
    return { ...r, profile: profile as ReportRow['profile'] };
  });
}

async function loadFlags(): Promise<{ flags: FlagRow[]; slugById: Map<string, { slug: string; display_name: string }> }> {
  const svc = getAdminServiceClient();
  const { data } = await svc
    .from('content_moderation_flags')
    .select('id, profile_id, field, severity, flags, content_snippet, source, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  const flags = (data ?? []) as FlagRow[];

  const ids = Array.from(new Set(flags.map((f) => f.profile_id).filter((v): v is string => Boolean(v))));
  const slugById = new Map<string, { slug: string; display_name: string }>();
  if (ids.length > 0) {
    const { data: profs } = await svc.from('profiles').select('id, slug, display_name').in('id', ids);
    for (const p of (profs ?? []) as { id: string; slug: string; display_name: string }[]) {
      slugById.set(p.id, { slug: p.slug, display_name: p.display_name });
    }
  }
  return { flags, slugById };
}

function formatRelative(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default async function ModerationQueuePage() {
  const [reports, { flags, slugById }] = await Promise.all([loadPendingReports(), loadFlags()]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-10">
      <header>
        <h1 className="text-2xl font-medium text-[var(--color-ink)] font-[family-name:var(--font-serif)]">
          Moderation
        </h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          User reports awaiting review, and recent automated content flags. Open a report to action it, or
          open a flagged profile to suspend or remove content.
        </p>
      </header>

      <section aria-labelledby="reports-heading">
        <h2 id="reports-heading" className="text-base font-medium text-[var(--color-ink)] mb-3">
          Pending reports ({reports.length})
        </h2>
        <div className="rounded-xl border border-[var(--color-border)] bg-white divide-y divide-[var(--color-border)]">
          {reports.length === 0 ? (
            <p className="p-5 text-sm text-[var(--color-muted)]">No reports awaiting review.</p>
          ) : (
            reports.map((r) => (
              <div key={r.id} className="p-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm text-[var(--color-ink)] truncate">
                    <span className="font-medium">{r.reason}</span>
                    {' against '}
                    {r.profile ? `${r.profile.display_name} (/${r.profile.slug})` : 'unknown profile'}
                  </p>
                  <p className="text-xs text-[var(--color-muted)] truncate">
                    {r.note ? `“${r.note}” · ` : ''}{formatRelative(r.created_at)}
                  </p>
                </div>
                <Link
                  href={`/admin/reports/${r.id}`}
                  className="text-xs font-medium px-4 py-2 rounded-full bg-[#f4efe7] text-[var(--color-ink)] hover:bg-[#ece7df] transition-colors shrink-0"
                >
                  Review →
                </Link>
              </div>
            ))
          )}
        </div>
      </section>

      <section aria-labelledby="flags-heading">
        <h2 id="flags-heading" className="text-base font-medium text-[var(--color-ink)] mb-3">
          Recent content flags ({flags.length})
        </h2>
        <p className="text-xs text-[var(--color-muted)] mb-3">
          Automated warn/block hits from the moderation library. Read-only triage — open the profile to act.
        </p>
        <div className="rounded-xl border border-[var(--color-border)] bg-white divide-y divide-[var(--color-border)]">
          {flags.length === 0 ? (
            <p className="p-5 text-sm text-[var(--color-muted)]">No content flags recorded.</p>
          ) : (
            flags.map((f) => {
              const prof = f.profile_id ? slugById.get(f.profile_id) : undefined;
              return (
                <div key={f.id} className="p-4 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm text-[var(--color-ink)] truncate">
                      <span
                        className={
                          'text-xs px-2 py-0.5 rounded-full mr-2 ' +
                          (f.severity === 'block' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700')
                        }
                      >
                        {f.severity}
                      </span>
                      <span className="font-medium">{f.field}</span>
                      {f.source ? <span className="text-[var(--color-muted)]"> · {f.source}</span> : null}
                    </p>
                    {f.content_snippet && (
                      <p className="text-xs text-[var(--color-muted)] mt-1 line-clamp-2">“{f.content_snippet}”</p>
                    )}
                    <p className="text-xs text-[var(--color-muted)] mt-1">
                      {(f.flags ?? []).join(', ') || 'no tags'} · {formatRelative(f.created_at)}
                    </p>
                  </div>
                  {prof ? (
                    <Link
                      href={`/admin/users/${prof.slug}`}
                      className="text-xs font-medium px-4 py-2 rounded-full bg-[#f4efe7] text-[var(--color-ink)] hover:bg-[#ece7df] transition-colors shrink-0"
                    >
                      View profile →
                    </Link>
                  ) : (
                    <span className="text-xs text-[var(--color-muted)] shrink-0">no profile</span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
