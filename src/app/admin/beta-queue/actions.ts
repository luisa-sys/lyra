'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentAdmin, getAdminServiceClient, logModerationAction } from '@/modules/admin/admin';
import { sendBetaApprovedEmail } from '@/modules/access/beta-access/email';
import { isSelfModeration } from '@/modules/trust-safety/user-actions';

/**
 * KAN-277 (epic KAN-273): approve a queued user into the beta.
 *
 * Admin-gated (getCurrentAdmin). Sets user_status='live' + access_tier='beta'
 * (+ the beta_approved_at audit timestamp) via the service-role client (which
 * passes the admin-only trigger from 20260620120100_beta_access_lockdown.sql),
 * audit-logs a 'grant_beta_access' moderation action, then emails the user a
 * "you're in" link (best-effort — degrades gracefully without RESEND_API_KEY).
 */
export async function approveBetaUser(formData: FormData): Promise<void> {
  const admin = await getCurrentAdmin();
  if (!admin) {
    throw new Error('Not authorised');
  }

  const profileId = String(formData.get('profile_id') ?? '').trim();
  const userId = String(formData.get('user_id') ?? '').trim();
  if (!profileId || !userId) {
    throw new Error('Missing target profile');
  }

  // SEC-118: an admin may not grant themselves beta access. Found by CTL-075
  // rather than by the ticket, which listed four moderation writers; this is a
  // fifth. The same capability is ALREADY refused through the bulk path —
  // `bulkUserAction` filters the acting admin out of `promote_live` — so
  // allowing it here was an inconsistency between two routes to one outcome,
  // which is the shape of the eight prior tickets in this family.
  //
  // It throws rather than redirecting because that is this action's own
  // convention for a refused input (see the two checks above); the sibling
  // actions in trust-safety/ redirect because they are page-bound.
  if (isSelfModeration(admin.profileId, profileId)) {
    throw new Error('You cannot approve your own beta access');
  }

  const svc = getAdminServiceClient();
  const { error } = await svc
    .from('profiles')
    .update({
      user_status: 'live',
      access_tier: 'beta',
      beta_approved_at: new Date().toISOString(),
    })
    .eq('id', profileId);
  if (error) {
    throw new Error(`Could not approve: ${error.message}`);
  }

  await logModerationAction({
    admin,
    action: 'grant_beta_access',
    targetProfileId: profileId,
    metadata: { user_id: userId },
  });

  // "You're in" email — never block/abort the approval if email fails.
  try {
    const { data } = await svc.auth.admin.getUserById(userId);
    const email = data?.user?.email;
    if (email) {
      await sendBetaApprovedEmail({ to: email });
    }
  } catch (e) {
    console.error('[beta-access] approval email failed', e);
  }

  revalidatePath('/admin/beta-queue');
}
