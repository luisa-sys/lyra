/**
 * KAN-141: /admin/reports — list of filed reports.
 *
 * Filterable by status via ?status=… query param. The default view
 * shows only `pending` because that's where the moderator's attention
 * is needed. Clicking through to a row opens the per-report detail
 * page where the actual moderation actions live.
 */

import Link from 'next/link';
import { getAdminServiceClient } from '@/lib/admin';

export const dynamic = 'force-dynamic';

type StatusFilter = 'pending' | 'reviewed' | 'actioned' | 'dismissed' | 'all';

interface ReportRow {
  id: string;
  reason: string;
  status: string;
  note: string | null;
  created_at: string;
  profile: { slug: string; display_name: string } | null;
}

async function listReports(status: StatusFilter): Promise<ReportRow[]> {
  const supabase = getAdminServiceClient();
  let q = supabase
    .from('reports')
    .select('id, reason, status, note, created_at, profile:profiles!reports_profile_id_fkey(slug, display_name)')
    .order('created_at', { ascending: false })
    .limit(100);

  if (status !== 'all') {
    q = q.eq('status', status);
  }

  const { data } = await q;
  return (data ?? []) as unknown as ReportRow[];
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default async function ReportsListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const filter: StatusFilter = (['pending', 'reviewed', 'actioned', 'dismissed', 'all'] as const)
    .includes(status as StatusFilter) ? (status as StatusFilter) : 'pending';

  const reports = await listReports(filter);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-medium text-[var(--color-ink)] font-[family-name:var(--font-serif)]">
          Reports
        </h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          User-filed reports. Resolve, dismiss, or action via the report detail page.
        </p>
      </header>

      <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
        {(['pending', 'actioned', 'dismissed', 'reviewed', 'all'] as const).map((s) => (
          <Link
            key={s}
            href={s === 'pending' ? '/admin/reports' : `/admin/reports?status=${s}`}
            className={
              'text-xs px-3 py-1.5 rounded-full transition-colors ' +
              (filter === s
                ? 'bg-[var(--color-ink)] text-white'
                : 'bg-stone-100 text-[var(--color-muted)] hover:bg-stone-200')
            }
          >
            {s}
          </Link>
        ))}
      </nav>

      <div className="rounded-xl border border-stone-200 bg-white divide-y divide-stone-100">
        {reports.length === 0 ? (
          <p className="p-5 text-sm text-[var(--color-muted)]">No reports match this filter.</p>
        ) : reports.map((r) => (
          <Link
            key={r.id}
            href={`/admin/reports/${r.id}`}
            className="block p-4 hover:bg-stone-50 transition-colors"
          >
            <div className="flex items-baseline justify-between gap-4 mb-1">
              <p className="text-sm text-[var(--color-ink)] truncate">
                <span className="font-medium">{r.reason}</span>
                {' · '}
                {r.profile ? (
                  <span>
                    {r.profile.display_name}{' '}
                    <span className="text-[var(--color-muted)]">(/{r.profile.slug})</span>
                  </span>
                ) : (
                  <span className="text-[var(--color-muted)]">unknown profile</span>
                )}
              </p>
              <span
                className={
                  'text-xs px-2 py-1 rounded-full shrink-0 ' +
                  (r.status === 'pending' ? 'bg-amber-50 text-amber-700'
                    : r.status === 'actioned' ? 'bg-green-50 text-green-700'
                    : r.status === 'dismissed' ? 'bg-stone-100 text-stone-600'
                    : 'bg-blue-50 text-blue-700')
                }
              >
                {r.status}
              </span>
            </div>
            {r.note && (
              <p className="text-xs text-[var(--color-muted)] line-clamp-2 mb-1">{r.note}</p>
            )}
            <p className="text-xs text-stone-500">{formatRelative(r.created_at)}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
