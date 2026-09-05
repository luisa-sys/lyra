/**
 * Report moderation — the audit-sensitive writes, lifted out of the page.
 * KAN-415 D7.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * These three actions lived as unexported `'use server'` closures inside
 * `src/app/admin/reports/[id]/page.tsx`. They are among the most
 * audit-sensitive writes in the product — they suspend a member, and they
 * close a report — and they had **zero unit coverage**, because a closure
 * that is never exported cannot be imported and therefore cannot be tested.
 * Not "was not tested": *could not be*. The plan calls this a hard
 * prerequisite for extracting `admin` at all.
 *
 * THE SHAPE, AND WHY IT IS THIS SHAPE
 * -----------------------------------
 * This is a PLAIN module — deliberately NOT a `'use server'` file. Under
 * Next 16 / React 19 a `'use server'` file may export ONLY async functions
 * (gotcha #18), and that rejection happens at action-INVOCATION time, not at
 * build time, so it ships green and 500s the first real form submission.
 * Keeping the logic here means it can export types and constants freely, and
 * can be imported by a test without the action runtime.
 *
 * The page keeps three thin `'use server'` closures whose only job is to pull
 * strings out of `FormData` and delegate here. Parsing a form is not the part
 * that needed testing; suspending a member is.
 *
 * ⚠️ THE FROZEN CONTRACT: AUDIT-FIRST.
 * `logModerationAction` THROWS if the `moderation_logs` insert fails, and
 * every function here calls it BEFORE the mutation it describes. That
 * ordering is the contract, not an implementation detail: a moderation action
 * we could not record is one we must not commit, because the alternative is a
 * suspended member with no forensic record of who suspended them or why.
 *
 * Ordering like this is invisible in review — swapping two awaits looks like
 * tidying — so it is asserted directly in
 * `tests/unit/trust-safety-report-actions.test.ts` rather than trusted.
 */
import { redirect } from 'next/navigation';
import { getCurrentAdmin, getAdminServiceClient, logModerationAction } from '@/modules/admin/admin';
import { isSelfModeration } from './user-actions';

/** The two ways a report can be closed without suspending anyone. */
export type ReportResolution = 'actioned' | 'dismissed';

/** The moderation-log action name that corresponds to each resolution. */
export type ReportResolutionAction = 'resolve_report' | 'dismiss_report';

/**
 * Close a report as actioned or dismissed.
 *
 * Reads the report first so the log row can name the target profile/item even
 * though the report row is about to change status — the audit trail records
 * WHAT was moderated, and after the update that association is harder to
 * reconstruct.
 */
export async function resolveReport(
  reportId: string,
  newStatus: ReportResolution,
  action: ReportResolutionAction,
  reason: string,
): Promise<void> {
  const admin = await getCurrentAdmin();
  if (!admin) redirect('/');

  const supabase = getAdminServiceClient();
  const { data: report } = await supabase
    .from('reports')
    .select('profile_id, profile_item_id')
    .eq('id', reportId)
    .maybeSingle();

  // Audit-first. Throws on failure, which aborts before the mutation below.
  await logModerationAction({
    admin,
    action,
    targetProfileId: (report?.profile_id as string | undefined) ?? null,
    targetItemId: (report?.profile_item_id as string | undefined) ?? null,
    reason: reason || null,
    metadata: { reportId },
  });

  await supabase
    .from('reports')
    .update({
      status: newStatus,
      resolved_by: admin.userId,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', reportId);
}

/**
 * Suspend the reported profile and mark the report actioned.
 *
 * Three writes in a fixed order: log, suspend, close. The log is first for the
 * reason in the file header. The report is closed LAST so that a failure
 * midway leaves the report open — an open report about an already-suspended
 * member is a visible inconsistency someone will resolve, whereas a closed
 * report about an un-suspended member looks like a decision that was made.
 *
 * SEC-118 — SELF-MODERATION. This was the ONLY writer of
 * `profiles.is_suspended` with no self-moderation guard; its three siblings
 * (`setSuspendState`, `setPublishedState`, `bulkUserAction`) all have one.
 * The consequence was not privilege escalation — an admin can already suspend
 * a peer through the sanctioned UI — it was an unrecoverable SELF-lockout:
 * `src/app/api/reports/route.ts` blocks only self-REPORTS, so any member can
 * report an admin, and on dev/staging `middleware.ts` then redirects that
 * admin to `/suspended` on every path with no self-unsuspend route anywhere.
 * Recovery needs a second admin or direct SQL.
 *
 * The guard is here, in the action, and not only in the page that hides the
 * button: a server action is reachable by anyone who can post a form, so it
 * must defend itself. That is the same reasoning `setSuspendState` states,
 * and `isSelfModeration` is IMPORTED from it rather than re-implemented —
 * re-implementing this guard per call site is precisely what produced the
 * gap (the plan predicted it at D7, and `docs/DEFECT_FEEDBACK_LOOP.md` counts
 * eight prior tickets in the same family).
 */
export async function suspendProfileFromReport(
  reportId: string,
  profileId: string,
  reason: string,
): Promise<void> {
  const admin = await getCurrentAdmin();
  if (!admin) redirect('/');

  // SEC-118: bail before the audit write, as the siblings do. Nothing is
  // logged, because nothing happened — a refused action is not a moderation
  // action, and writing one would put noise in the tamper-evident trail.
  if (isSelfModeration(admin.profileId, profileId)) {
    redirect(`/admin/reports/${reportId}`);
  }

  const supabase = getAdminServiceClient();
  const effectiveReason = reason || 'Action taken following report';

  // 1. Audit-first: if this throws we do NOT suspend anyone.
  await logModerationAction({
    admin,
    action: 'suspend',
    targetProfileId: profileId,
    reason: effectiveReason,
    metadata: { reportId },
  });

  // 2. Suspend the profile.
  await supabase
    .from('profiles')
    .update({
      is_suspended: true,
      suspended_at: new Date().toISOString(),
      suspension_reason: effectiveReason,
    })
    .eq('id', profileId);

  // 3. Mark the report as actioned.
  await supabase
    .from('reports')
    .update({
      status: 'actioned',
      resolved_by: admin.userId,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', reportId);
}
