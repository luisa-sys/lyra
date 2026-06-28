'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentAdmin, getAdminServiceClient, logModerationAction } from '@/lib/admin';
import { sendBetaApprovedEmail } from '@/lib/beta-access/email';

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
