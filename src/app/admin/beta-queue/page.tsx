/**
 * KAN-277 — /admin/beta-queue.
 *
 * Lists every profile waiting in the beta queue (beta_access_status =
 * 'requested'), oldest request first, with the person's display name and the
 * email from auth.users. Each row has an Approve button that:
 *   - logs a `grant_beta_access` moderation action,
 *   - sets beta_access_status='approved' + is_beta_eligible=true +
 *     beta_approved_at=now(),
 *   - emails the user a "you're in" link to the beta app.
 *
 * Admin-gated: the /admin layout already 404s non-admins, and this page +
 * its action re-check getCurrentAdmin() defensively (notFound / no-op).
 */

import { notFound, redirect } from 'next/navigation';
import { getCurrentAdmin, getAdminServiceClient } from '@/lib/admin';
import { approveBetaRequest } from './approve';

export const dynamic = 'force-dynamic';

interface QueueRow {
  id: string;
  user_id: string;
  display_name: string | null;
  email: string | null;
  beta_requested_at: string | null;
}

async function loadQueue(): Promise<QueueRow[]> {
  const supabase = getAdminServiceClient();
  const { data } = await supabase
    .from('profiles')
    .select('id, user_id, display_name, beta_requested_at')
    .eq('beta_access_status', 'requested')
    .order('beta_requested_at', { ascending: true });

  const rows = (data ?? []) as Omit<QueueRow, 'email'>[];

  // Resolve each requester's email from auth.users via the admin client.
  // Sequential is fine — the queue is small by construction.
  const withEmail: QueueRow[] = [];
  for (const row of rows) {
    let email: string | null = null;
    try {
      const { data: authData } = await supabase.auth.admin.getUserById(row.user_id);
      email = authData?.user?.email ?? null;
    } catch {
      email = null;
    }
    withEmail.push({ ...row, email });
  }
  return withEmail;
}

// ── Server action ─────────────────────────────────────────────────

async function actionApprove(formData: FormData) {
  'use server';
  const admin = await getCurrentAdmin();
  if (!admin) redirect('/');

  const profileId = String(formData.get('profileId') ?? '');
  if (!profileId) redirect('/admin/beta-queue');

  await approveBetaRequest(admin, profileId);
  redirect('/admin/beta-queue');
}

// ── UI ────────────────────────────────────────────────────────────

export default async function BetaQueuePage() {
  const admin = await getCurrentAdmin();
  if (!admin) notFound();

  const queue = await loadQueue();

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-medium text-[var(--color-ink)] font-[family-name:var(--font-serif)]">
          Beta queue
        </h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          {queue.length} {queue.length === 1 ? 'person' : 'people'} waiting for beta access.
        </p>
      </header>

      <div className="rounded-xl border border-[var(--color-border)] bg-white divide-y divide-[var(--color-border)]">
        {queue.length === 0 ? (
          <p className="p-5 text-sm text-[var(--color-muted)]">
            No one is waiting in the queue.
          </p>
        ) : (
          queue.map((row) => (
            <div
              key={row.id}
              className="p-4 flex items-center justify-between gap-4"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--color-ink)] truncate">
                  {row.display_name ?? '(no name)'}
                </p>
                <p className="text-xs text-[var(--color-muted)] truncate">
                  {row.email ?? '(no email)'}
                  {row.beta_requested_at && (
                    <>
                      {' · requested '}
                      {new Date(row.beta_requested_at).toLocaleDateString('en-GB', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </>
                  )}
                </p>
              </div>
              <form action={actionApprove} className="shrink-0">
                <input type="hidden" name="profileId" value={row.id} />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-full bg-[var(--color-lyra-sage)] text-white text-sm font-medium hover:bg-[var(--color-lyra-sage-hover)] transition-colors"
                >
                  Approve
                </button>
              </form>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
