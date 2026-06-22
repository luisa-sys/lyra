/**
 * KAN-309 / KAN-314: monitoring / ops dashboard.
 *
 * Live in-app view for the operator:
 *   - Activity metrics over 1h / 24h / 7d via the existing get_metrics_for_window
 *     RPC (src/lib/metrics.ts).
 *   - Operational counts (lifecycle stages, suspended, pending reports, recent
 *     flags, admins) via the service-role client.
 *   - External-tools panel: Sentry / UptimeRobot configured-or-not status + a
 *     link out. Status is derived from env presence and labelled explicitly —
 *     never a silent "looks fine" (Workflow Integrity policy).
 */

import Link from 'next/link';
import { getAdminServiceClient } from '@/lib/admin';
import { getAnomalyWindow, type AnomalyWindowKey, type MetricsSnapshot } from '@/lib/metrics';

export const dynamic = 'force-dynamic';

const WINDOWS: AnomalyWindowKey[] = ['1h', '24h', '7d'];

async function safeWindow(key: AnomalyWindowKey): Promise<MetricsSnapshot | null> {
  try {
    return await getAnomalyWindow(key);
  } catch (e) {
    console.error(`[admin/monitoring] metrics ${key} failed`, e);
    return null;
  }
}

async function getCounts() {
  const svc = getAdminServiceClient();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [waitlist, beta, live, suspended, pendingReports, flags7d, admins, total] = await Promise.all([
    svc.from('profiles').select('id', { count: 'exact', head: true }).eq('access_stage', 'waitlist'),
    svc.from('profiles').select('id', { count: 'exact', head: true }).eq('access_stage', 'beta'),
    svc.from('profiles').select('id', { count: 'exact', head: true }).eq('access_stage', 'live'),
    svc.from('profiles').select('id', { count: 'exact', head: true }).eq('is_suspended', true),
    svc.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    svc.from('content_moderation_flags').select('id', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo),
    svc.from('profiles').select('id', { count: 'exact', head: true }).eq('is_admin', true),
    svc.from('profiles').select('id', { count: 'exact', head: true }),
  ]);
  return {
    waitlist: waitlist.count ?? 0,
    beta: beta.count ?? 0,
    live: live.count ?? 0,
    suspended: suspended.count ?? 0,
    pendingReports: pendingReports.count ?? 0,
    flags7d: flags7d.count ?? 0,
    admins: admins.count ?? 0,
    total: total.count ?? 0,
  };
}

function StatCard({ label, value, href }: { label: string; value: number; href?: string }) {
  const body = (
    <div className="p-5 rounded-xl border border-[var(--color-border)] bg-white">
      <p className="text-xs uppercase tracking-wider text-[var(--color-muted)] mb-2">{label}</p>
      <p className="text-2xl font-semibold text-[var(--color-ink)]">{value.toLocaleString()}</p>
    </div>
  );
  return href ? <Link href={href} className="block hover:shadow-sm transition-shadow">{body}</Link> : body;
}

function ExternalRow({ name, configured, href }: { name: string; configured: boolean; href: string }) {
  return (
    <div className="p-4 flex items-center justify-between gap-4">
      <span className="text-sm text-[var(--color-ink)]">{name}</span>
      <div className="flex items-center gap-3">
        <span
          className={
            'text-xs px-2 py-0.5 rounded-full ' +
            (configured ? 'bg-green-50 text-green-700' : 'bg-[#f4efe7] text-[var(--color-muted)]')
          }
        >
          {configured ? 'configured' : 'not configured'}
        </span>
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)]">
          Open ↗
        </a>
      </div>
    </div>
  );
}

export default async function MonitoringPage() {
  const [counts, windows] = await Promise.all([
    getCounts(),
    Promise.all(WINDOWS.map((w) => safeWindow(w))),
  ]);

  const sentryConfigured = Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN);
  const uptimeConfigured = Boolean(process.env.UPTIMEROBOT_API_KEY);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-10">
      <header>
        <h1 className="text-2xl font-medium text-[var(--color-ink)] font-[family-name:var(--font-serif)]">
          Monitoring
        </h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">Live activity and operational health.</p>
      </header>

      <section aria-label="Counts" className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Waitlist" value={counts.waitlist} href="/admin/users?stage=waitlist" />
        <StatCard label="Beta" value={counts.beta} href="/admin/users?stage=beta" />
        <StatCard label="Live" value={counts.live} href="/admin/users?stage=live" />
        <StatCard label="Total signups" value={counts.total} href="/admin/users" />
        <StatCard label="Suspended" value={counts.suspended} href="/admin/users?suspended=1" />
        <StatCard label="Pending reports" value={counts.pendingReports} href="/admin/moderation" />
        <StatCard label="Flags · 7d" value={counts.flags7d} href="/admin/moderation" />
        <StatCard label="Admins" value={counts.admins} href="/admin/users?admin=1" />
      </section>

      <section aria-labelledby="activity-heading">
        <h2 id="activity-heading" className="text-base font-medium text-[var(--color-ink)] mb-3">Activity</h2>
        <div className="rounded-xl border border-[var(--color-border)] bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#f4efe7]">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Window</th>
                <th className="text-right px-4 py-2 font-medium">Signups</th>
                <th className="text-right px-4 py-2 font-medium">Publishes</th>
                <th className="text-right px-4 py-2 font-medium">Items added</th>
                <th className="text-right px-4 py-2 font-medium">Reports</th>
              </tr>
            </thead>
            <tbody>
              {WINDOWS.map((w, i) => {
                const m = windows[i];
                return (
                  <tr key={w} className="border-t border-[var(--color-border)]">
                    <td className="px-4 py-2 text-[var(--color-ink)]">Last {w}</td>
                    {m === null ? (
                      <td colSpan={4} className="px-4 py-2 text-right text-[var(--color-muted)]">data unavailable</td>
                    ) : (
                      <>
                        <td className="px-4 py-2 text-right text-[var(--color-ink)]">{m.profile_signups}</td>
                        <td className="px-4 py-2 text-right text-[var(--color-ink)]">{m.profile_publishes}</td>
                        <td className="px-4 py-2 text-right text-[var(--color-ink)]">{m.profile_items_added}</td>
                        <td className="px-4 py-2 text-right text-[var(--color-ink)]">{m.reports_filed}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="external-heading">
        <h2 id="external-heading" className="text-base font-medium text-[var(--color-ink)] mb-3">External monitoring</h2>
        <div className="rounded-xl border border-[var(--color-border)] bg-white divide-y divide-[var(--color-border)]">
          <ExternalRow name="Sentry (errors)" configured={sentryConfigured} href="https://sentry.io" />
          <ExternalRow name="UptimeRobot (uptime)" configured={uptimeConfigured} href="https://dashboard.uptimerobot.com" />
          <ExternalRow name="Public status page" configured href="https://checklyra.com/status" />
        </div>
      </section>
    </div>
  );
}
