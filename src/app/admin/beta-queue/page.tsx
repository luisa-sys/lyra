/**
 * KAN-277 (epic KAN-273): /admin/beta-queue — people awaiting beta approval.
 *
 * Admin-gated by the /admin layout (getCurrentAdmin → notFound for non-admins).
 * Lists profiles with beta_access_status='requested'; each row has an Approve
 * button wired to the approveBetaUser server action.
 */
import { getAdminServiceClient } from '@/lib/admin';
import { approveBetaUser } from './actions';

export const dynamic = 'force-dynamic';

interface QueueRow {
  id: string;
  user_id: string;
  display_name: string | null;
  slug: string;
  beta_requested_at: string | null;
}

async function listRequested(): Promise<QueueRow[]> {
  const svc = getAdminServiceClient();
  const { data } = await svc
    .from('profiles')
    .select('id, user_id, display_name, slug, beta_requested_at')
    .eq('beta_access_status', 'requested')
    .order('beta_requested_at', { ascending: true })
    .limit(200);
  return (data ?? []) as unknown as QueueRow[];
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default async function BetaQueuePage() {
  const rows = await listRequested();

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-medium text-[var(--color-ink)] font-[family-name:var(--font-serif)]">
          Beta queue
        </h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          People who have requested access. Approving lets them into the beta and emails them a
          &ldquo;you&rsquo;re in&rdquo; link.
        </p>
      </header>

      <div className="rounded-xl border border-[var(--color-border)] bg-white divide-y divide-[var(--color-border)]">
        {rows.length === 0 ? (
          <p className="p-5 text-sm text-[var(--color-muted)]">No one is waiting for approval.</p>
        ) : (
          rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="text-sm text-[var(--color-ink)] truncate">
                  <span className="font-medium">{r.display_name ?? 'Unnamed'}</span>{' '}
                  <span className="text-[var(--color-muted)]">(/{r.slug})</span>
                </p>
                <p className="text-xs text-[var(--color-muted)]">
                  requested {formatRelative(r.beta_requested_at)}
                </p>
              </div>
              <form action={approveBetaUser}>
                <input type="hidden" name="profile_id" value={r.id} />
                <input type="hidden" name="user_id" value={r.user_id} />
                <button
                  type="submit"
                  className="text-xs font-medium px-4 py-2 rounded-full bg-[var(--color-sage)] text-white hover:opacity-90 transition-opacity shrink-0"
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
