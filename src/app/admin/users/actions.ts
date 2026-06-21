'use server';

/**
 * KAN-309 / KAN-311: bulk user-management actions for the admin console.
 *
 * One server action (`bulkUserAction`) handles every bulk transition — enable /
 * disable beta, promote to live (± early access), suspend / unsuspend — over a
 * set of selected profiles. Contract, in order:
 *
 *   1. Re-check admin (never trust the client).
 *   2. Resolve the target IDs. For "select all matching filter" the IDs are
 *      re-materialised SERVER-SIDE from the filter via admin_filter_profile_ids
 *      — a client-supplied ID list is never trusted for the select-all case.
 *   3. De-dupe + exclude the admin's own profile (self-action guard), enforce cap.
 *   4. Audit-first: one moderation_logs row per target (abort if it fails).
 *   5. Apply the update via the service-role client (passes the admin-only
 *      prevent_beta_self_elevation trigger).
 *   6. Best-effort, bounded approval emails (never aborts the mutation).
 */

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase-server';
import { getCurrentAdmin, getAdminServiceClient, logModerationActionsBatch } from '@/lib/admin';
import { sendBetaApprovedEmail } from '@/lib/beta-access/email';
import {
  BULK_MAX,
  EMAIL_CAP,
  computeAccessTransition,
  isBulkAction,
  type BulkAction,
  type UserFilter,
} from './users-actions-shared';

function parseFilter(formData: FormData): UserFilter {
  const str = (k: string): string | null => {
    const v = String(formData.get(k) ?? '').trim();
    return v.length ? v : null;
  };
  const tri = (k: string): boolean | null => {
    const v = String(formData.get(k) ?? '').trim();
    if (v === 'true') return true;
    if (v === 'false') return false;
    return null;
  };
  return {
    search: str('f_search'),
    stage: str('f_stage'),
    early: tri('f_early'),
    suspended: tri('f_suspended'),
    admin: tri('f_admin'),
  };
}

export async function bulkUserAction(formData: FormData): Promise<void> {
  const admin = await getCurrentAdmin();
  if (!admin) {
    throw new Error('Not authorised');
  }

  const action = String(formData.get('action') ?? '').trim();
  if (!isBulkAction(action)) {
    throw new Error('Unknown action');
  }
  const reason = String(formData.get('reason') ?? '').trim();
  if (action === 'suspend' && !reason) {
    throw new Error('A reason is required to suspend');
  }

  // 1 + 2. Resolve target IDs.
  let ids: string[];
  if (String(formData.get('selectAll') ?? '') === 'true') {
    const filter = parseFilter(formData);
    const supabase = await createClient(); // cookie session → RPC admin check passes
    const { data, error } = await supabase.rpc('admin_filter_profile_ids', {
      p_search: filter.search,
      p_stage: filter.stage,
      p_early: filter.early,
      p_suspended: filter.suspended,
      p_admin: filter.admin,
      p_cap: BULK_MAX,
    });
    if (error) {
      throw new Error(`Could not resolve selection: ${error.message}`);
    }
    ids = (data as string[] | null) ?? [];
  } else {
    ids = formData.getAll('ids').map((v) => String(v)).filter(Boolean);
  }

  // 3. De-dupe + self-action guard + cap.
  ids = Array.from(new Set(ids)).filter((id) => id !== admin.profileId);
  if (ids.length === 0) {
    throw new Error('No users selected');
  }
  if (ids.length > BULK_MAX) {
    throw new Error(`Too many users (${ids.length}). Refine the filter; bulk is capped at ${BULK_MAX}.`);
  }

  const now = new Date().toISOString();
  const transition = computeAccessTransition(action as BulkAction, { now, reason: reason || null });

  // 4. Audit-first — abort the whole action if we can't record it.
  await logModerationActionsBatch({
    admin,
    action: transition.moderationAction,
    targetProfileIds: ids,
    reason: reason || null,
    metadata: { bulk: true, requested_action: action, count: ids.length },
  });

  // 5. Apply the change (service role passes the admin-only trigger).
  const svc = getAdminServiceClient();
  const { error: updErr } = await svc.from('profiles').update(transition.update).in('id', ids);
  if (updErr) {
    throw new Error(`Could not update users: ${updErr.message}`);
  }

  // 6. Best-effort approval emails, bounded — never roll back the mutation.
  if (transition.sendApprovalEmail) {
    const targets = ids.slice(0, EMAIL_CAP);
    if (ids.length > EMAIL_CAP) {
      console.warn(
        `[admin] bulk ${action}: emailed first ${EMAIL_CAP} of ${ids.length}; remainder not emailed`,
      );
    }
    try {
      const { data: rows } = await svc.from('profiles').select('user_id').in('id', targets);
      const userIds = (rows ?? [])
        .map((r) => (r as { user_id?: string }).user_id)
        .filter((v): v is string => Boolean(v));
      for (const userId of userIds) {
        try {
          const { data: u } = await svc.auth.admin.getUserById(userId);
          const email = u?.user?.email;
          if (email) await sendBetaApprovedEmail({ to: email });
        } catch (e) {
          console.error('[admin] bulk approval email failed', e);
        }
      }
    } catch (e) {
      console.error('[admin] bulk approval email lookup failed', e);
    }
  }

  revalidatePath('/admin/users');
}
