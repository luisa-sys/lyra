/**
 * KAN-424 (F2, epic KAN-414 / KAN-415): the access-transition matrix.
 *
 * This is the single source of truth for how a user moves between access
 * states. It used to live in `src/app/admin/users/users-actions-shared.ts` —
 * inside the admin UI route tree — which made it the codebase's only
 * `src/lib/**` -> `src/app/**` import edge: `src/modules/access/beta-access/flow.ts` and
 * `src/app/waitlist/actions.ts` both reached into the admin console for it.
 * It is a pure policy function, not an admin-console detail, so it lives here.
 *
 * Moved verbatim in KAN-424 — the function body is unchanged, by design (see
 * that ticket's Security Review: this is motion, not an edit). The admin-only
 * symbols (BULK_ACTIONS, BULK_MAX, EMAIL_CAP, UserFilter) deliberately stayed
 * behind in the console, because they genuinely are admin's.
 *
 * Pure by construction: `now` and `reason` are passed in, so there is no
 * Date.now() and no I/O, and it is directly unit-testable without a DB.
 */

import type { ModerationAction } from '@/lib/admin';
import type { Database } from '@/types/database';

/** The two axes of the access model (KAN-326). */
export type UserStatus = 'not_applied' | 'waitlist' | 'live';
export type AccessTier = 'beta' | 'prod';

/**
 * The vocabulary of access transitions.
 *
 * The admin console's `BULK_ACTIONS` is one presentation of this list (it adds
 * labels and danger flags, which are UI concerns); typing `BulkActionConfig.value`
 * as `AccessAction` keeps the two in lockstep at compile time without dragging
 * the console's menu ordering into this module.
 */
export type AccessAction =
  | 'enable_beta'
  | 'disable_beta'
  | 'promote_live_with_beta'
  | 'promote_live_no_beta'
  | 'suspend'
  | 'unsuspend';

export interface AccessTransition {
  /**
   * The partial `profiles` update to apply.
   *
   * SEC-132: typed as the generated `profiles` Update row, not
   * `Record<string, unknown>`. This is the single source of truth for how a
   * user moves between access states — including `suspend` — and every value
   * here is written straight to the profiles table by three callers (the admin
   * console, the waitlist action, and the beta-access flow).
   *
   * As `Record<string, unknown>` a misspelled column was accepted by the
   * compiler AND by PostgREST-via-an-untyped-client, so `user_staus: 'live'`
   * would have been a silent no-op: the update succeeds, affects the columns it
   * recognises, and the account simply never transitions. Naming the real row
   * type makes that a build error.
   */
  update: Database['public']['Tables']['profiles']['Update'];
  /** The moderation_logs action string to audit. */
  moderationAction: ModerationAction;
  /** Whether a "you're in" approval email is appropriate for this transition. */
  sendApprovalEmail: boolean;
}

/**
 * Map an access action onto the concrete column changes + audit action.
 *
 * KAN-326: the clean axes (user_status, access_tier) are the SOLE source of
 * truth. The legacy state columns (access_stage, early_access, is_beta_eligible,
 * beta_access_status) were dropped in Phase C — this function no longer writes
 * them. `beta_approved_at` / `beta_requested_at` are kept as audit timestamps.
 * `now` and `reason` are passed in to keep this function pure (no Date.now / no I/O).
 */
export function computeAccessTransition(
  action: AccessAction,
  opts: { now: string; reason?: string | null },
): AccessTransition {
  switch (action) {
    case 'enable_beta':
      return {
        update: {
          user_status: 'live',
          access_tier: 'beta',
          beta_approved_at: opts.now,
        },
        moderationAction: 'enable_beta',
        sendApprovalEmail: true,
      };
    case 'disable_beta':
      return {
        update: {
          user_status: 'waitlist',
          access_tier: 'beta',
          beta_approved_at: null,
        },
        moderationAction: 'disable_beta',
        sendApprovalEmail: false,
      };
    case 'promote_live_with_beta':
      return {
        update: {
          user_status: 'live',
          access_tier: 'prod',
        },
        moderationAction: 'promote_live',
        sendApprovalEmail: true,
      };
    case 'promote_live_no_beta':
      return {
        // KAN-326 Phase C: with the legacy early_access flag dropped, "with" vs
        // "without beta features" no longer differs at the column level — both
        // set access_tier='prod'. Experimental-feature access for a prod-tier
        // user is now an explicit feature_entitlements grant (KAN-328), not a
        // profile column. The two actions still differ in the approval email.
        update: {
          user_status: 'live',
          access_tier: 'prod',
        },
        moderationAction: 'promote_live',
        sendApprovalEmail: false,
      };
    case 'suspend':
      return {
        update: {
          is_suspended: true,
          suspended_at: opts.now,
          suspension_reason: opts.reason ?? null,
        },
        moderationAction: 'suspend',
        sendApprovalEmail: false,
      };
    case 'unsuspend':
      return {
        update: {
          is_suspended: false,
          suspended_at: null,
          suspension_reason: null,
        },
        moderationAction: 'unsuspend',
        sendApprovalEmail: false,
      };
  }
}
