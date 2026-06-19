/**
 * KAN-141: per-report detail + moderation action page.
 *
 * Shows the full report (reporter, reason, note, status, target), the
 * target profile state, and a form with three options: Resolve as
 * Actioned, Dismiss, or Suspend the target profile. Every form
 * submission goes through a server action that updates the report,
 * mutates the target (if applicable), AND writes a moderation_logs
 * row through `logModerationAction`.
 */

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentAdmin, getAdminServiceClient, logModerationAction } from '@/lib/admin';

export const dynamic = 'force-dynamic';

interface FullReport {
  id: string;
  profile_id: string;
  profile_item_id: string | null;
  reporter_user_id: string | null;
  reason: string;
  note: string | null;
  status: string;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  profile: {
    id: string;
    slug: string;
    display_name: string;
    is_suspended: boolean;
    is_published: boolean;
  } | null;
}

async function loadReport(id: string): Promise<FullReport | null> {
  const supabase = getAdminServiceClient();
  const { data } = await supabase
    .from('reports')
    .select('id, profile_id, profile_item_id, reporter_user_id, reason, note, status, resolved_by, resolved_at, created_at, profile:profiles!reports_profile_id_fkey(id, slug, display_name, is_suspended, is_published)')
    .eq('id', id)
    .maybeSingle();
  return (data ?? null) as unknown as FullReport | null;
}

// ── Server actions ────────────────────────────────────────────────

async function actionDismissReport(formData: FormData) {
  'use server';
  const reportId = String(formData.get('reportId') ?? '');
  const reason = String(formData.get('reason') ?? '');
  await dismissOrResolveReport(reportId, 'dismissed', 'dismiss_report', reason);
}

async function actionResolveReport(formData: FormData) {
  'use server';
  const reportId = String(formData.get('reportId') ?? '');
  const reason = String(formData.get('reason') ?? '');
  await dismissOrResolveReport(reportId, 'actioned', 'resolve_report', reason);
}

async function actionSuspendProfile(formData: FormData) {
  'use server';
  const reportId = String(formData.get('reportId') ?? '');
  const profileId = String(formData.get('profileId') ?? '');
  const reason = String(formData.get('reason') ?? '');

  const admin = await getCurrentAdmin();
  if (!admin) redirect('/');

  const supabase = getAdminServiceClient();

  // 1. Audit-first: write the moderation log entry. If this fails we
  // do NOT proceed with the mutation — see comment in logModerationAction.
  await logModerationAction({
    admin,
    action: 'suspend',
    targetProfileId: profileId,
    reason: reason || 'Action taken following report',
    metadata: { reportId },
  });

  // 2. Suspend the profile.
  await supabase
    .from('profiles')
    .update({
      is_suspended: true,
      suspended_at: new Date().toISOString(),
      suspension_reason: reason || 'Action taken following report',
    })
    .eq('id', profileId);

  // 3. Mark the report as actioned.
  await supabase
    .from('reports')
    .update({
      status: 'actioned',
      resolved_by: admin.userId,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', reportId);

  redirect('/admin/reports');
}

async function dismissOrResolveReport(
  reportId: string,
  newStatus: 'actioned' | 'dismissed',
  action: 'resolve_report' | 'dismiss_report',
  reason: string,
) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect('/');

  const supabase = getAdminServiceClient();
  const { data: report } = await supabase
    .from('reports')
    .select('profile_id, profile_item_id')
    .eq('id', reportId)
    .maybeSingle();

  await logModerationAction({
    admin,
    action,
    targetProfileId: (report?.profile_id as string | undefined) ?? null,
    targetItemId: (report?.profile_item_id as string | undefined) ?? null,
    reason: reason || null,
    metadata: { reportId },
  });

  await supabase
    .from('reports')
    .update({
      status: newStatus,
      resolved_by: admin.userId,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', reportId);

  redirect('/admin/reports');
}

// ── UI ────────────────────────────────────────────────────────────

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const report = await loadReport(id);
  if (!report) notFound();

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
      <header>
        <Link href="/admin/reports" className="text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)]">
          ← Back to reports
        </Link>
        <h1 className="text-2xl font-medium text-[var(--color-ink)] font-[family-name:var(--font-serif)] mt-2">
          Report detail
        </h1>
      </header>

      <section aria-label="Report" className="p-5 rounded-xl border border-[var(--color-border)] bg-white space-y-3">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wider text-[var(--color-muted)]">Reason</dt>
            <dd className="text-[var(--color-ink)]">{report.reason}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-[var(--color-muted)]">Status</dt>
            <dd className="text-[var(--color-ink)]">{report.status}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-[var(--color-muted)]">Target profile</dt>
            <dd className="text-[var(--color-ink)]">
              {report.profile ? (
                <Link
                  href={`/admin/users/${report.profile.slug}`}
                  className="underline hover:text-[var(--color-sage)]"
                >
                  {report.profile.display_name} (/{report.profile.slug})
                </Link>
              ) : (
                <span className="text-[var(--color-muted)]">deleted profile</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-[var(--color-muted)]">Profile state</dt>
            <dd>
              {report.profile?.is_suspended ? (
                <span className="text-red-700">Suspended</span>
              ) : report.profile?.is_published ? (
                <span className="text-green-700">Published</span>
              ) : (
                <span className="text-[var(--color-muted)]">Draft</span>
              )}
            </dd>
          </div>
        </dl>
        {report.note && (
          <div>
            <dt className="text-xs uppercase tracking-wider text-[var(--color-muted)]">Reporter note</dt>
            <dd className="text-sm text-[var(--color-ink)] mt-1 whitespace-pre-wrap">{report.note}</dd>
          </div>
        )}
      </section>

      {report.status === 'pending' ? (
        <section aria-label="Actions" className="p-5 rounded-xl border border-[var(--color-border)] bg-white space-y-6">
          <h2 className="text-base font-medium text-[var(--color-ink)]">Take action</h2>

          <form action={actionResolveReport} className="space-y-3">
            <input type="hidden" name="reportId" value={report.id} />
            <label htmlFor="resolve-reason" className="block text-sm text-[var(--color-ink)]">
              Resolution notes (optional)
            </label>
            <input
              id="resolve-reason"
              name="reason"
              type="text"
              maxLength={500}
              className="w-full p-2 text-sm rounded-lg border border-[var(--color-border)] bg-white"
              placeholder="e.g. profile content reviewed and edited"
            />
            <button
              type="submit"
              className="px-5 py-2 rounded-full bg-[var(--color-lyra-sage)] text-white text-sm font-medium hover:bg-[var(--color-lyra-sage-hover)] transition-colors"
            >
              Mark as actioned
            </button>
          </form>

          <form action={actionDismissReport} className="space-y-3 pt-2 border-t border-[var(--color-border)]">
            <input type="hidden" name="reportId" value={report.id} />
            <input
              name="reason"
              type="text"
              maxLength={500}
              className="w-full p-2 text-sm rounded-lg border border-[var(--color-border)] bg-white"
              placeholder="Dismissal reason (optional)"
            />
            <button
              type="submit"
              className="px-5 py-2 rounded-full bg-[#f4efe7] text-[var(--color-ink)] text-sm font-medium hover:bg-[#ece7df] transition-colors"
            >
              Dismiss report
            </button>
          </form>

          {report.profile && !report.profile.is_suspended && (
            <form action={actionSuspendProfile} className="space-y-3 pt-2 border-t border-[var(--color-border)]">
              <input type="hidden" name="reportId" value={report.id} />
              <input type="hidden" name="profileId" value={report.profile.id} />
              <label htmlFor="suspend-reason" className="block text-sm text-[var(--color-ink)]">
                Suspension reason (will be recorded)
              </label>
              <input
                id="suspend-reason"
                name="reason"
                type="text"
                maxLength={500}
                required
                className="w-full p-2 text-sm rounded-lg border border-[var(--color-border)] bg-white"
                placeholder="e.g. repeated harassment"
              />
              <button
                type="submit"
                className="px-5 py-2 rounded-full bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
              >
                Suspend profile + mark report actioned
              </button>
            </form>
          )}
        </section>
      ) : (
        <p className="text-sm text-[var(--color-muted)]">
          This report has been resolved. No further actions available.
        </p>
      )}
    </div>
  );
}
