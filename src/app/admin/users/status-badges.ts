/**
 * KAN-326: shared badge logic for the admin user views, so the list (BulkBar,
 * a client island) and the detail page (a server component) render the
 * status / access / publish badges identically. Plain module — no
 * 'use client' / 'use server' — so both surfaces can import it.
 */

export type Badge = { label: string; cls: string };

/** User status (one badge): suspended > admin > lifecycle (live/waitlist/not_applied). */
export function userStatusBadge(u: {
  is_suspended: boolean;
  is_admin: boolean;
  user_status: 'not_applied' | 'waitlist' | 'live';
}): Badge {
  if (u.is_suspended) return { label: 'suspended', cls: 'bg-red-50 text-red-700' };
  if (u.is_admin) return { label: 'admin', cls: 'bg-blue-50 text-blue-700' };
  switch (u.user_status) {
    case 'live':
      return { label: 'live', cls: 'bg-green-50 text-green-700' };
    case 'waitlist':
      return { label: 'waitlist', cls: 'bg-amber-50 text-amber-700' };
    default:
      return { label: 'not applied', cls: 'bg-[#f4efe7] text-[var(--color-muted)]' };
  }
}

/** Access tier — which site the user is routed to. */
export function accessBadge(tier: 'beta' | 'prod'): Badge {
  return tier === 'prod'
    ? { label: 'prod', cls: 'bg-sky-50 text-sky-700' }
    : { label: 'beta', cls: 'bg-violet-50 text-violet-700' };
}

/**
 * Publish status (computed): public > private.
 *
 * The former "age check" state is gone: age is a self-declaration at sign-up,
 * not a publish-time gate, so nothing blocks a profile from going public.
 */
export function publishBadge(u: { is_published: boolean }): Badge {
  return u.is_published
    ? { label: 'public', cls: 'bg-green-50 text-green-700' }
    : { label: 'private', cls: 'bg-[#f4efe7] text-[var(--color-muted)]' };
}
