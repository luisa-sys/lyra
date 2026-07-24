/**
 * KAN-277 — core "approve a beta queue request" logic.
 *
 * Lives in a plain `.ts` (not the page's inline 'use server' action) so it's
 * unit-testable in isolation and so the page file stays free of non-async
 * exports (CLAUDE.md gotcha #18). The page's server action is a thin wrapper
 * that gates on getCurrentAdmin() then calls this.
 *
 * Order of operations mirrors the existing moderation pattern: write the
 * audit log FIRST (so a failed mutation is still recorded), then flip the
 * profile to approved, then send the "you're in" email (best-effort).
 */

import {
  getAdminServiceClient,
  logModerationAction,
  type AdminUser,
} from '@/lib/admin';
import { notifyBetaApproved } from '@/lib/beta-access';

export interface ApproveBetaRequestResult {
  ok: boolean;
  emailed: boolean;
}

/**
 * Approve a single beta-queue profile.
 *
 * @param admin   the verified admin performing the action
 * @param profileId  the profile row id to approve
 */
export async function approveBetaRequest(
  admin: AdminUser,
  profileId: string
): Promise<ApproveBetaRequestResult> {
  // 1. Audit log first.
  await logModerationAction({
    admin,
    action: 'grant_beta_access',
    targetProfileId: profileId,
  });

  const supabase = getAdminServiceClient();

  // 2. Look up the user so we can email them. We read user_id + display_name
  //    here; the email comes from auth.users via the admin client.
  const { data: profile } = await supabase
    .from('profiles')
    .select('user_id, display_name')
    .eq('id', profileId)
    .maybeSingle();

  // 3. Flip to approved. Sets BOTH the new status column and the existing
  //    is_beta_eligible gate the beta middleware already reads.
  await supabase
    .from('profiles')
    .update({
      beta_access_status: 'approved',
      is_beta_eligible: true,
      beta_approved_at: new Date().toISOString(),
    })
    .eq('id', profileId);

  // 4. Email the user (best-effort — never throws).
  const userId = (profile as { user_id?: string } | null)?.user_id;
  const displayName =
    (profile as { display_name?: string | null } | null)?.display_name ?? null;

  let emailed = false;
  if (userId) {
    const { data: authData } = await supabase.auth.admin.getUserById(userId);
    const email = authData?.user?.email ?? null;
    if (email) {
      await notifyBetaApproved({ to: email, displayName });
      emailed = true;
    }
  }

  return { ok: true, emailed };
}
