/**
 * KAN-141: per-user admin view.
 *
 * Shows the profile state, recent items, link to public profile, and
 * the suspend / unsuspend / delete-item actions. Self-moderation is
 * blocked at the UI level (button hidden) and also at the action level
 * (rejected if target_profile_id resolves to the admin's own profile).
 */

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentAdmin, getAdminServiceClient, logModerationAction } from '@/lib/admin';
import { getProfileEntitlements } from '@/lib/features/entitlements-service';
import { FEATURE_KEYS, FEATURE_CONFIG } from '@/lib/features/registry';
import { setFeatureEntitlement } from '../actions';

export const dynamic = 'force-dynamic';

interface ProfileFull {
  id: string;
  user_id: string;
  display_name: string | null;
  slug: string;
  headline: string | null;
  bio_short: string | null;
  is_published: boolean;
  is_suspended: boolean;
  is_admin: boolean;
  suspended_at: string | null;
  suspension_reason: string | null;
  created_at: string;
}

interface ItemRow {
  id: string;
  category: string;
  title: string;
  description: string | null;
  visibility: string;
  created_at: string;
}

async function loadProfile(slug: string): Promise<ProfileFull | null> {
  const supabase = getAdminServiceClient();
  const { data } = await supabase
    .from('profiles')
    .select('id, user_id, display_name, slug, headline, bio_short, is_published, is_suspended, is_admin, suspended_at, suspension_reason, created_at')
    .eq('slug', slug)
    .maybeSingle();
  return (data ?? null) as ProfileFull | null;
}

async function loadItems(profileId: string): Promise<ItemRow[]> {
  const supabase = getAdminServiceClient();
  const { data } = await supabase
    .from('profile_items')
    .select('id, category, title, description, visibility, created_at')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(50);
  return (data ?? []) as ItemRow[];
}

// ── Server actions ────────────────────────────────────────────────

async function actionSuspend(formData: FormData) {
  'use server';
  await setSuspendState(formData, true);
}

async function actionUnsuspend(formData: FormData) {
  'use server';
  await setSuspendState(formData, false);
}

async function setSuspendState(formData: FormData, suspend: boolean) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect('/');

  const profileId = String(formData.get('profileId') ?? '');
  const slug = String(formData.get('slug') ?? '');
  const reason = String(formData.get('reason') ?? '');

  // Self-moderation guard. The admin's own profileId must never equal
  // the target. Bail silently — UI doesn't render the button in this
  // case but action handlers must be self-defending.
  if (profileId === admin.profileId) {
    redirect(`/admin/users/${slug}`);
  }

  await logModerationAction({
    admin,
    action: suspend ? 'suspend' : 'unsuspend',
    targetProfileId: profileId,
    reason: reason || null,
  });

  const supabase = getAdminServiceClient();
  await supabase
    .from('profiles')
    .update(suspend
      ? { is_suspended: true, suspended_at: new Date().toISOString(), suspension_reason: reason || null }
      : { is_suspended: false, suspended_at: null, suspension_reason: null }
    )
    .eq('id', profileId);

  redirect(`/admin/users/${slug}`);
}

async function actionDeleteItem(formData: FormData) {
  'use server';
  const admin = await getCurrentAdmin();
  if (!admin) redirect('/');

  const itemId = String(formData.get('itemId') ?? '');
  const profileId = String(formData.get('profileId') ?? '');
  const slug = String(formData.get('slug') ?? '');
  const reason = String(formData.get('reason') ?? '');

  await logModerationAction({
    admin,
    action: 'delete_item',
    targetProfileId: profileId,
    targetItemId: itemId,
    reason: reason || null,
  });

  const supabase = getAdminServiceClient();
  await supabase.from('profile_items').delete().eq('id', itemId);

  redirect(`/admin/users/${slug}`);
}

// ── UI ────────────────────────────────────────────────────────────

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const admin = (await getCurrentAdmin())!; // layout already gated
  const profile = await loadProfile(slug);
  if (!profile) notFound();
  const items = await loadItems(profile.id);
  const entitlements = await getProfileEntitlements(profile.id);
  const isSelf = profile.id === admin.profileId;

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
      <header>
        <Link href="/admin/users" className="text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)]">
          ← Back to users
        </Link>
        <h1 className="text-2xl font-medium text-[var(--color-ink)] font-[family-name:var(--font-serif)] mt-2">
          {profile.display_name ?? '(no name)'}
        </h1>
        <p className="text-sm text-[var(--color-muted)]">
          <Link href={`/${profile.slug}`} className="underline">/{profile.slug}</Link>
          {' · joined '}
          {new Date(profile.created_at).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })}
        </p>
      </header>

      <section className="p-5 rounded-xl border border-[var(--color-border)] bg-white">
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wider text-[var(--color-muted)]">Status</dt>
            <dd className="mt-1">
              {profile.is_suspended ? (
                <span className="text-red-700">Suspended</span>
              ) : profile.is_published ? (
                <span className="text-green-700">Published</span>
              ) : (
                <span className="text-[var(--color-muted)]">Draft</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-[var(--color-muted)]">Admin</dt>
            <dd className="mt-1">{profile.is_admin ? 'Yes' : 'No'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-[var(--color-muted)]">Items</dt>
            <dd className="mt-1">{items.length}</dd>
          </div>
          {profile.is_suspended && profile.suspension_reason && (
            <div className="sm:col-span-3">
              <dt className="text-xs uppercase tracking-wider text-[var(--color-muted)]">Suspension reason</dt>
              <dd className="text-[var(--color-ink)] mt-1">{profile.suspension_reason}</dd>
            </div>
          )}
        </dl>
      </section>

      {!isSelf && (
        <section className="p-5 rounded-xl border border-[var(--color-border)] bg-white space-y-4">
          <h2 className="text-base font-medium text-[var(--color-ink)]">Actions</h2>
          {profile.is_suspended ? (
            <form action={actionUnsuspend} className="flex flex-wrap gap-3 items-end">
              <input type="hidden" name="profileId" value={profile.id} />
              <input type="hidden" name="slug" value={profile.slug} />
              <input
                name="reason"
                type="text"
                maxLength={500}
                className="flex-1 min-w-[200px] p-2 text-sm rounded-lg border border-[var(--color-border)] bg-white"
                placeholder="Unsuspension note (optional)"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-full bg-[var(--color-lyra-sage)] text-white text-sm font-medium hover:bg-[var(--color-lyra-sage-hover)] transition-colors"
              >
                Unsuspend
              </button>
            </form>
          ) : (
            <form action={actionSuspend} className="flex flex-wrap gap-3 items-end">
              <input type="hidden" name="profileId" value={profile.id} />
              <input type="hidden" name="slug" value={profile.slug} />
              <input
                name="reason"
                type="text"
                maxLength={500}
                required
                className="flex-1 min-w-[200px] p-2 text-sm rounded-lg border border-[var(--color-border)] bg-white"
                placeholder="Suspension reason (required)"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-full bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
              >
                Suspend
              </button>
            </form>
          )}
        </section>
      )}

      <section className="p-5 rounded-xl border border-[var(--color-border)] bg-white">
        <h2 className="text-base font-medium text-[var(--color-ink)]">Feature access</h2>
        <p className="text-xs text-[var(--color-muted)] mt-1 mb-3">
          Per-user beta features. Each also needs its environment switch on to take effect.
        </p>
        <div className="divide-y divide-[var(--color-border)]">
          {FEATURE_KEYS.map((k) => {
            const cfg = FEATURE_CONFIG[k];
            const on = entitlements[k];
            return (
              <div key={k} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-[var(--color-ink)]">
                    <span className="font-medium">{cfg.label}</span>{' '}
                    <span
                      className={
                        'text-xs px-2 py-0.5 rounded-full ' +
                        (on ? 'bg-green-50 text-green-700' : 'bg-[#f4efe7] text-[var(--color-muted)]')
                      }
                    >
                      {on ? 'on' : 'off'}
                    </span>
                  </p>
                  <p className="text-xs text-[var(--color-muted)]">
                    {cfg.description}
                    {cfg.envPrerequisite ? ` · needs ${cfg.envPrerequisite}` : ''}
                  </p>
                </div>
                <form action={setFeatureEntitlement} className="shrink-0">
                  <input type="hidden" name="profileId" value={profile.id} />
                  <input type="hidden" name="slug" value={profile.slug} />
                  <input type="hidden" name="featureKey" value={k} />
                  <input type="hidden" name="enabled" value={(!on).toString()} />
                  <button
                    type="submit"
                    className={
                      'text-xs font-medium px-4 py-2 rounded-full transition-colors ' +
                      (on
                        ? 'bg-[#f4efe7] text-red-700 hover:bg-red-50'
                        : 'bg-[var(--color-sage)] text-white hover:opacity-90')
                    }
                  >
                    {on ? 'Disable' : 'Enable'}
                  </button>
                </form>
              </div>
            );
          })}
        </div>
      </section>

      <section className="p-5 rounded-xl border border-[var(--color-border)] bg-white">
        <h2 className="text-base font-medium text-[var(--color-ink)] mb-3">Items</h2>
        {items.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">No items on this profile.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {items.map((it) => (
              <li key={it.id} className="py-3 flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-[var(--color-ink)] truncate">
                    <span className="text-xs uppercase tracking-wider text-[var(--color-muted)] mr-2">
                      {it.category}
                    </span>
                    {it.title}
                  </p>
                  {it.description && (
                    <p className="text-xs text-[var(--color-muted)] line-clamp-1">{it.description}</p>
                  )}
                </div>
                {!isSelf && (
                  <form action={actionDeleteItem} className="flex items-center gap-2 shrink-0">
                    <input type="hidden" name="itemId" value={it.id} />
                    <input type="hidden" name="profileId" value={profile.id} />
                    <input type="hidden" name="slug" value={profile.slug} />
                    <input
                      name="reason"
                      type="text"
                      maxLength={500}
                      className="p-1.5 text-xs rounded border border-[var(--color-border)] bg-white w-32"
                      placeholder="Reason"
                    />
                    <button
                      type="submit"
                      className="text-xs px-3 py-1.5 rounded-full bg-[#f4efe7] text-red-700 hover:bg-red-50 transition-colors"
                    >
                      Delete
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
