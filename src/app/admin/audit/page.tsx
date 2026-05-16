/**
 * KAN-141: /admin/audit — read-only moderation log viewer.
 *
 * Append-only history of every admin action. Ordered most recent first.
 * No actions on this page — just a transparent record of what happened
 * and who did it.
 */

import Link from 'next/link';
import { getAdminServiceClient } from '@/lib/admin';

export const dynamic = 'force-dynamic';

interface LogRow {
  id: string;
  action: string;
  reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  actor_user_id: string;
  target_profile_id: string | null;
  actor_profile: { display_name: string | null; slug: string } | null;
  target_profile: { display_name: string | null; slug: string } | null;
}

async function loadLogs(): Promise<LogRow[]> {
  const supabase = getAdminServiceClient();
  const { data } = await supabase
    .from('moderation_logs')
    .select(`
      id, action, reason, metadata, created_at,
      actor_user_id, target_profile_id,
      actor_profile:profiles!moderation_logs_actor_user_id_fkey(display_name, slug),
      target_profile:profiles!moderation_logs_target_profile_id_fkey(display_name, slug)
    `)
    .order('created_at', { ascending: false })
    .limit(100);
  return ((data ?? []) as unknown) as LogRow[];
}

function actionLabel(action: string): string {
  return action.replace(/_/g, ' ');
}

function actionColour(action: string): string {
  if (action.includes('suspend') && !action.startsWith('un')) return 'bg-red-50 text-red-700';
  if (action.startsWith('un') || action === 'restore_item') return 'bg-green-50 text-green-700';
  if (action.includes('delete')) return 'bg-red-50 text-red-700';
  if (action.includes('grant_admin') || action.includes('revoke_admin')) return 'bg-blue-50 text-blue-700';
  return 'bg-stone-100 text-stone-700';
}

export default async function AuditLogPage() {
  const logs = await loadLogs();

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-medium text-[var(--color-ink)] font-[family-name:var(--font-serif)]">
          Audit log
        </h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          Every admin action, append-only. Most recent first. Showing up to 100 entries.
        </p>
      </header>

      <div className="rounded-xl border border-stone-200 bg-white divide-y divide-stone-100">
        {logs.length === 0 ? (
          <p className="p-5 text-sm text-[var(--color-muted)]">No moderation actions recorded yet.</p>
        ) : logs.map((log) => (
          <div key={log.id} className="p-4 space-y-1">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm text-[var(--color-ink)] truncate">
                <span className={'text-xs px-2 py-0.5 rounded-full mr-2 ' + actionColour(log.action)}>
                  {actionLabel(log.action)}
                </span>
                <span className="text-[var(--color-muted)]">by</span>{' '}
                {log.actor_profile ? (
                  <Link href={`/admin/users/${log.actor_profile.slug}`} className="underline">
                    {log.actor_profile.display_name ?? '(unnamed)'}
                  </Link>
                ) : (
                  <span className="italic">(account deleted)</span>
                )}
                {log.target_profile && (
                  <>
                    {' '}
                    <span className="text-[var(--color-muted)]">on</span>{' '}
                    <Link href={`/admin/users/${log.target_profile.slug}`} className="underline">
                      {log.target_profile.display_name ?? '(unnamed)'}
                    </Link>
                  </>
                )}
              </p>
              <span className="text-xs text-stone-500 shrink-0">
                {new Date(log.created_at).toLocaleString('en-GB')}
              </span>
            </div>
            {log.reason && <p className="text-xs text-[var(--color-muted)] italic">{log.reason}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
