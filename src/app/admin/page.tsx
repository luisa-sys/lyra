/**
 * KAN-141: admin overview / dashboard.
 *
 * Server Component — reads everything fresh on each request. We deliberately
 * skip caching: the whole point of this page is "what's happening right
 * now". Reports queue, recent signups, suspension counts. Cached data
 * would defeat the operator's mental model.
 *
 * Queries are all on the service-role client because admins can see
 * everything; the RLS policies on these tables also accept admin reads
 * via cookie session, but service-role is one consistent path for both
 * "read everything" routes and "show counts" — avoids two query shapes.
 */

import Link from 'next/link';
import { getCurrentAdmin, getAdminServiceClient } from '@/lib/admin';

export const dynamic = 'force-dynamic';

async function getCounts() {
  const supabase = getAdminServiceClient();

  // Run all four counts concurrently — they're independent and small.
  const [totalProfiles, publishedProfiles, suspendedProfiles, pendingReports] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_published', true),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_suspended', true),
    supabase.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
  ]);

  // 7-day signup count — uses a single point-in-time threshold computed
  // here so we don't query the DB twice for the same window.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recentSignups = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', sevenDaysAgo);

  return {
    totalProfiles: totalProfiles.count ?? 0,
    publishedProfiles: publishedProfiles.count ?? 0,
    suspendedProfiles: suspendedProfiles.count ?? 0,
    pendingReports: pendingReports.count ?? 0,
    signups7d: recentSignups.count ?? 0,
  };
}

async function getRecentSignups() {
  const supabase = getAdminServiceClient();
  const { data } = await supabase
    .from('profiles')
    .select('id, display_name, slug, created_at, is_published, is_suspended')
    .order('created_at', { ascending: false })
    .limit(10);
  return data ?? [];
}

async function getRecentReports() {
  const supabase = getAdminServiceClient();
  const { data } = await supabase
    .from('reports')
    .select('id, reason, status, created_at, profile:profiles!reports_profile_id_fkey(slug, display_name)')
    .order('created_at', { ascending: false })
    .limit(10);
  return data ?? [];
}

function StatCard({ label, value, href }: { label: string; value: number; href?: string }) {
  const body = (
    <div className="p-5 rounded-xl border border-stone-200 bg-white">
      <p className="text-xs uppercase tracking-wider text-[var(--color-muted)] mb-2">{label}</p>
      <p className="text-2xl font-semibold text-[var(--color-ink)]">{value.toLocaleString()}</p>
    </div>
  );
  return href ? (
    <Link href={href} className="block hover:shadow-sm transition-shadow">
      {body}
    </Link>
  ) : body;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default async function AdminOverviewPage() {
  // Layout already ran the admin gate; this is just a typing reload so
  // we have the admin record in scope if any UI needs it later. Cheap.
  await getCurrentAdmin();

  const [counts, recentSignups, recentReports] = await Promise.all([
    getCounts(),
    getRecentSignups(),
    getRecentReports(),
  ]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-10">
      <header>
        <h1 className="text-2xl font-medium text-[var(--color-ink)] font-[family-name:var(--font-serif)]">
          Overview
        </h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          Counts and recent activity. Drill into a section above for actions.
        </p>
      </header>

      <section aria-label="Counts" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard label="Total profiles" value={counts.totalProfiles} />
        <StatCard label="Published" value={counts.publishedProfiles} />
        <StatCard label="Suspended" value={counts.suspendedProfiles} href="/admin/users?filter=suspended" />
        <StatCard label="Pending reports" value={counts.pendingReports} href="/admin/reports?status=pending" />
        <StatCard label="Signups · 7d" value={counts.signups7d} />
      </section>

      <section aria-labelledby="recent-signups-heading">
        <h2 id="recent-signups-heading" className="text-base font-medium text-[var(--color-ink)] mb-3">
          Recent signups
        </h2>
        <div className="rounded-xl border border-stone-200 bg-white divide-y divide-stone-100">
          {recentSignups.length === 0 ? (
            <p className="p-5 text-sm text-[var(--color-muted)]">No profiles yet.</p>
          ) : recentSignups.map((p) => (
            <div key={p.id as string} className="p-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--color-ink)] truncate">
                  {(p.display_name as string) || '(no name)'}
                </p>
                <p className="text-xs text-[var(--color-muted)] truncate">
                  /{p.slug as string} · {formatRelative(p.created_at as string)}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {p.is_suspended ? (
                  <span className="text-xs px-2 py-1 rounded-full bg-red-50 text-red-700">Suspended</span>
                ) : p.is_published ? (
                  <span className="text-xs px-2 py-1 rounded-full bg-green-50 text-green-700">Published</span>
                ) : (
                  <span className="text-xs px-2 py-1 rounded-full bg-stone-100 text-stone-600">Draft</span>
                )}
                <Link
                  href={`/admin/users/${p.slug as string}`}
                  className="text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors"
                >
                  View →
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="recent-reports-heading">
        <h2 id="recent-reports-heading" className="text-base font-medium text-[var(--color-ink)] mb-3">
          Recent reports
        </h2>
        <div className="rounded-xl border border-stone-200 bg-white divide-y divide-stone-100">
          {recentReports.length === 0 ? (
            <p className="p-5 text-sm text-[var(--color-muted)]">No reports filed.</p>
          ) : recentReports.map((r) => {
            // Supabase typegen sometimes infers the FK lookup as an array,
            // sometimes as a single object — depends on the cardinality. We
            // route through unknown so we don't depend on the inferred type.
            const profCandidate = r.profile as unknown;
            const prof = Array.isArray(profCandidate)
              ? (profCandidate[0] as { slug: string; display_name: string } | undefined) ?? null
              : (profCandidate as { slug: string; display_name: string } | null);
            return (
              <div key={r.id as string} className="p-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm text-[var(--color-ink)] truncate">
                    <span className="font-medium">{r.reason as string}</span>
                    {' against '}
                    {prof ? `${prof.display_name} (/${prof.slug})` : 'unknown profile'}
                  </p>
                  <p className="text-xs text-[var(--color-muted)]">
                    {formatRelative(r.created_at as string)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={
                      'text-xs px-2 py-1 rounded-full ' +
                      (r.status === 'pending'
                        ? 'bg-amber-50 text-amber-700'
                        : r.status === 'actioned'
                        ? 'bg-green-50 text-green-700'
                        : 'bg-stone-100 text-stone-600')
                    }
                  >
                    {r.status as string}
                  </span>
                  <Link
                    href={`/admin/reports/${r.id as string}`}
                    className="text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors"
                  >
                    Open →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
