/**
 * User moderation — suspend, publish-state and item deletion. KAN-415 D7.
 *
 * Lifted from unexported `'use server'` closures in
 * `src/app/admin/users/[slug]/page.tsx`, for the reason given in
 * report-actions.ts: a closure that is never exported cannot be imported, so
 * these had zero unit coverage and could not have had any.
 *
 * ⚠️ FINDING, PRESERVED NOT FIXED — THE SELF-MODERATION GUARD IS ASYMMETRIC.
 *
 * The guard that stops an admin moderating their own profile was written
 * TWICE, once inside each of setSuspendState and setPublishedState, as the
 * plan predicted ("self-moderation guard re-implemented per closure"). The
 * third action, deleting a profile item, has NO guard at all.
 *
 * That asymmetry is REPRODUCED here exactly, deliberately, and is asserted by
 * tests so it cannot drift further. It is not fixed in this commit because
 * adding a guard where none existed is a BEHAVIOUR CHANGE, and this is a
 * behaviour-preserving move — the whole basis on which it can be reviewed as
 * safe. Fixing and moving in one commit means neither can be verified.
 *
 * Whether an admin should be able to delete an item from their own profile is
 * a product decision, not a refactor: it is plausibly fine (an admin tidying
 * their own profile is not self-dealing in the way self-unsuspension is), and
 * plausibly a hole. It needs an owner. Raised in the PR rather than resolved
 * here.
 *
 * The duplication IS fixed: both callers now share `isSelfModeration`, so the
 * two copies cannot diverge from each other, which is how one of them would
 * eventually have been fixed and the other missed.
 *
 * ⚠️ AUDIT-FIRST, as in report-actions.ts: `logModerationAction` throws when
 * the `moderation_logs` insert fails and is called BEFORE every mutation. A
 * moderation action we could not record must not commit.
 */
import { redirect } from 'next/navigation';
import { getCurrentAdmin, getAdminServiceClient, logModerationAction } from '@/lib/admin';

/** The admin's own profile is never a legitimate moderation target. */
export function isSelfModeration(
  adminProfileId: string | null | undefined,
  targetProfileId: string,
): boolean {
  // Both must be present AND equal. A null adminProfileId must never match a
  // null target and silently block a real moderation action — "unknown" is
  // not "the same person".
  return Boolean(adminProfileId) && adminProfileId === targetProfileId;
}

/**
 * Suspend or unsuspend a profile.
 *
 * Bails silently (a redirect back to the same page) on self-moderation. The UI
 * does not render the button in that case, but an action handler is reachable
 * by anyone who can post a form and must defend itself.
 */
export async function setSuspendState(
  profileId: string,
  slug: string,
  reason: string,
  suspend: boolean,
): Promise<void> {
  const admin = await getCurrentAdmin();
  if (!admin) redirect('/');

  if (isSelfModeration(admin.profileId, profileId)) {
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
    .update(
      suspend
        ? {
            is_suspended: true,
            suspended_at: new Date().toISOString(),
            suspension_reason: reason || null,
          }
        : { is_suspended: false, suspended_at: null, suspension_reason: null },
    )
    .eq('id', profileId);

  redirect(`/admin/users/${slug}`);
}

/**
 * Hide or restore a profile publicly.
 *
 * Unpublishing keeps the owner's edit access (owner RLS) but removes the
 * profile from public reads (published-only RLS). Re-publishing restores it.
 */
export async function setPublishedState(
  profileId: string,
  slug: string,
  reason: string,
  publish: boolean,
): Promise<void> {
  const admin = await getCurrentAdmin();
  if (!admin) redirect('/');

  if (isSelfModeration(admin.profileId, profileId)) {
    redirect(`/admin/users/${slug}`);
  }

  await logModerationAction({
    admin,
    action: publish ? 'republish' : 'unpublish',
    targetProfileId: profileId,
    reason: reason || null,
  });

  const supabase = getAdminServiceClient();
  await supabase.from('profiles').update({ is_published: publish }).eq('id', profileId);

  redirect(`/admin/users/${slug}`);
}

/**
 * Delete a single profile item.
 *
 * ⚠️ NO SELF-MODERATION GUARD — see the file header. This reproduces the
 * behaviour that existed before the move; it is not an endorsement of it.
 */
export async function deleteProfileItem(
  itemId: string,
  profileId: string,
  slug: string,
  reason: string,
): Promise<void> {
  const admin = await getCurrentAdmin();
  if (!admin) redirect('/');

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
