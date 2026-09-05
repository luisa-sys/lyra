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
import { getCurrentAdmin, getAdminServiceClient } from '@/modules/admin/admin';
import {
  setSuspendState,
  setPublishedState,
  deleteProfileItem,
} from '@/modules/trust-safety/user-actions';
import { getProfileEntitlements } from '@/modules/features/entitlements-service';
import { FEATURE_CONFIG, GA_FEATURE_KEYS, TEST_FEATURE_KEYS, type FeatureKey } from '@/modules/features/registry';
import { getGlobalSwitches } from '@/modules/features/global-switches-service';
import { GLOBAL_FEATURE_KEYS, GLOBAL_FEATURE_CONFIG } from '@/modules/features/global-features';
import { getDeployEnv } from '@/modules/platform/deploy-env';
import { setFeatureEntitlement } from '../actions';
import { userStatusBadge, accessBadge, publishBadge } from '../status-badges';

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
  user_status: 'not_applied' | 'waitlist' | 'live';
  access_tier: 'beta' | 'prod';
  suspended_at: string | null;
  suspension_reason: string | null;
  age_declared_18_at: string | null;
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
    .select('id, user_id, display_name, slug, headline, bio_short, is_published, is_suspended, is_admin, user_status, access_tier, suspended_at, suspension_reason, age_declared_18_at, created_at')
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
//
// KAN-415 D7: the moderation logic moved to
// src/modules/trust-safety/user-actions.ts, where it can be imported and
// tested. What remains is FormData parsing — these closures stay in the page
// because a `'use server'` file may export only async functions (gotcha #18),
// rejected at action-invocation time rather than at build time.

async function actionSuspend(formData: FormData) {
  'use server';
  await setSuspendState(
    String(formData.get('profileId') ?? ''),
    String(formData.get('slug') ?? ''),
    String(formData.get('reason') ?? ''),
    true,
  );
}

async function actionUnsuspend(formData: FormData) {
  'use server';
  await setSuspendState(
    String(formData.get('profileId') ?? ''),
    String(formData.get('slug') ?? ''),
    String(formData.get('reason') ?? ''),
    false,
  );
}

async function actionUnpublish(formData: FormData) {
  'use server';
  await setPublishedState(
    String(formData.get('profileId') ?? ''),
    String(formData.get('slug') ?? ''),
    String(formData.get('reason') ?? ''),
    false,
  );
}

async function actionRepublish(formData: FormData) {
  'use server';
  await setPublishedState(
    String(formData.get('profileId') ?? ''),
    String(formData.get('slug') ?? ''),
    String(formData.get('reason') ?? ''),
    true,
  );
}

async function actionDeleteItem(formData: FormData) {
  'use server';
  await deleteProfileItem(
    String(formData.get('itemId') ?? ''),
    String(formData.get('profileId') ?? ''),
    String(formData.get('slug') ?? ''),
    String(formData.get('reason') ?? ''),
  );
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

  // KAN-408: hide per-user toggles for features that are OFF at the global level
  // in THIS environment — a globally-off feature cannot be overridden per user,
  // so no per-user control is shown (only a read-only pointer to /admin/features).
  const globalSwitches = await getGlobalSwitches(getDeployEnv());
  const hiddenUserFeatureKeys = new Set<FeatureKey>();
  const globallyOffLabels: string[] = [];
  for (const gk of GLOBAL_FEATURE_KEYS) {
    const uk = GLOBAL_FEATURE_CONFIG[gk].userFeatureKey;
    if (uk && !globalSwitches[gk]) {
      hiddenUserFeatureKeys.add(uk);
      globallyOffLabels.push(GLOBAL_FEATURE_CONFIG[gk].label);
    }
  }
  const visibleTestKeys = TEST_FEATURE_KEYS.filter((k) => !hiddenUserFeatureKeys.has(k));
  const visibleGaKeys = GA_FEATURE_KEYS.filter((k) => !hiddenUserFeatureKeys.has(k));

  const st = userStatusBadge(profile);
  const ac = accessBadge(profile.access_tier);
  const pb = publishBadge(profile);

  const renderFeatureRow = (k: FeatureKey) => {
    const cfg = FEATURE_CONFIG[k];
    const on = entitlements[k];
    const revokedDefault = cfg.tier === 'ga' && !on;
    return (
      <div key={k} className="py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-[var(--color-ink)]">
            <span className="font-medium">{cfg.label}</span>{' '}
            <span
              className={
                'text-xs px-2 py-0.5 rounded-full ' +
                (revokedDefault
                  ? 'bg-orange-50 text-orange-700'
                  : on
                    ? 'bg-green-50 text-green-700'
                    : 'bg-[#f4efe7] text-[var(--color-muted)]')
              }
            >
              {revokedDefault ? 'disabled' : on ? 'on' : 'off'}
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
  };

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
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wider text-[var(--color-muted)]">User status</dt>
            <dd className="mt-1">
              <span className={'text-xs px-2 py-0.5 rounded-full ' + st.cls}>{st.label}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-[var(--color-muted)]">Access</dt>
            <dd className="mt-1">
              <span className={'text-xs px-2 py-0.5 rounded-full ' + ac.cls}>{ac.label}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-[var(--color-muted)]">Publish</dt>
            <dd className="mt-1">
              <span className={'text-xs px-2 py-0.5 rounded-full ' + pb.cls}>{pb.label}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-[var(--color-muted)]">Items</dt>
            <dd className="mt-1">{items.length}</dd>
          </div>
          {profile.is_suspended && profile.suspension_reason && (
            <div className="col-span-2 sm:col-span-4">
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

          <div className="pt-4 border-t border-[var(--color-border)]">
            <p className="text-xs text-[var(--color-muted)] mb-2">
              {profile.is_published
                ? 'Published — visible to others. Unpublishing keeps the owner’s edit access but hides the profile from the public.'
                : 'Not published — private to the owner.'}
            </p>
            {profile.is_published ? (
              <form action={actionUnpublish} className="flex flex-wrap gap-3 items-end">
                <input type="hidden" name="profileId" value={profile.id} />
                <input type="hidden" name="slug" value={profile.slug} />
                <input
                  name="reason"
                  type="text"
                  maxLength={500}
                  className="flex-1 min-w-[200px] p-2 text-sm rounded-lg border border-[var(--color-border)] bg-white"
                  placeholder="Unpublish reason (optional)"
                />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-full bg-[#f4efe7] text-[var(--color-ink)] text-sm font-medium hover:bg-[#ece7df] transition-colors"
                >
                  Unpublish (make private)
                </button>
              </form>
            ) : (
              <form action={actionRepublish} className="flex flex-wrap gap-3 items-end">
                <input type="hidden" name="profileId" value={profile.id} />
                <input type="hidden" name="slug" value={profile.slug} />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-full bg-[var(--color-sage)] text-white text-sm font-medium hover:opacity-90 transition-colors"
                >
                  Re-publish
                </button>
              </form>
            )}
          </div>
        </section>
      )}

      <section className="p-5 rounded-xl border border-[var(--color-border)] bg-white space-y-5">
        <h2 className="text-base font-medium text-[var(--color-ink)]">Feature access</h2>

        {globallyOffLabels.length > 0 && (
          <p className="text-xs text-[var(--color-muted)] bg-[#f4efe7] rounded-lg px-3 py-2">
            {globallyOffLabels.join(', ')} {globallyOffLabels.length === 1 ? 'is' : 'are'} off
            globally in this environment, so {globallyOffLabels.length === 1 ? 'its' : 'their'}{' '}
            per-user control{globallyOffLabels.length === 1 ? ' is' : 's are'} hidden. Manage global
            switches in{' '}
            <Link href="/admin/features" className="underline">
              Features
            </Link>
            .
          </p>
        )}

        {visibleTestKeys.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-[var(--color-ink)]">Test features</h3>
            <p className="text-xs text-[var(--color-muted)] mt-0.5 mb-2">
              Experimental, off by default — the set we trial with beta users. Each also needs its environment switch on to take effect.
            </p>
            <div className="divide-y divide-[var(--color-border)]">
              {visibleTestKeys.map(renderFeatureRow)}
            </div>
          </div>
        )}

        <div>
          <h3 className="text-sm font-medium text-[var(--color-ink)]">Default-on features</h3>
          <p className="text-xs text-[var(--color-muted)] mt-0.5 mb-2">
            On for everyone. You can still turn one off for this user — they’ll then show a “features disabled” badge.
          </p>
          <div className="divide-y divide-[var(--color-border)]">
            {visibleGaKeys.map(renderFeatureRow)}
          </div>
        </div>
      </section>

      <section className="p-5 rounded-xl border border-[var(--color-border)] bg-white">
        <h2 className="text-base font-medium text-[var(--color-ink)]">Age (18+ self-declaration)</h2>
        <p className="text-xs text-[var(--color-muted)] mt-1">
          {profile.age_declared_18_at ? (
            <>
              Confirmed they are 18 or over at sign-up on{' '}
              <span className="text-[var(--color-ink)]">
                {new Date(profile.age_declared_18_at).toLocaleString('en-GB')}
              </span>
              .
            </>
          ) : (
            <>
              No declaration on record — this account was created before the 18+
              confirmation was introduced.
            </>
          )}
          {' '}Lyra records the user&rsquo;s own declaration; it is not a verified age
          check, so there is nothing for an admin to override here. Use suspend if an
          account should not be on the platform.
        </p>
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
