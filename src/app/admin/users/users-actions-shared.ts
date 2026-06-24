/**
 * KAN-309 (epic) / KAN-311: pure helpers + constants for the user-management
 * console's bulk actions.
 *
 * This file is NOT 'use server' — it holds the runtime constants, types and the
 * pure transition function so the action module (`actions.ts`) can stay
 * async-only (BUGS-12: a 'use server' file may only export async functions).
 *
 * The transition matrix is the single source of truth for how each admin action
 * maps onto the two-axis access model (access_stage + early_access) AND the
 * legacy enforced gate (is_beta_eligible / beta_access_status). Keeping it pure
 * makes it directly unit-testable without a DB.
 */

import type { ModerationAction } from '@/lib/admin';

/** Hard ceiling on a single bulk action (server-enforced). */
export const BULK_MAX = 500;

/** Max approval emails to send per bulk action (best-effort, bounded). */
export const EMAIL_CAP = 100;

export interface BulkActionConfig {
  value: string;
  label: string;
  requiresReason: boolean;
  danger: boolean;
}

/** The bulk actions the console offers, in menu order. */
export const BULK_ACTIONS = [
  { value: 'enable_beta', label: 'Enable beta', requiresReason: false, danger: false },
  { value: 'disable_beta', label: 'Disable beta', requiresReason: false, danger: true },
  { value: 'promote_live_with_beta', label: 'Promote to live (with beta)', requiresReason: false, danger: false },
  { value: 'promote_live_no_beta', label: 'Promote to live (no beta)', requiresReason: false, danger: false },
  { value: 'suspend', label: 'Suspend', requiresReason: true, danger: true },
  { value: 'unsuspend', label: 'Unsuspend', requiresReason: false, danger: false },
] as const satisfies readonly BulkActionConfig[];

export type BulkAction = (typeof BULK_ACTIONS)[number]['value'];

const BULK_ACTION_VALUES = new Set<string>(BULK_ACTIONS.map((a) => a.value));

export function isBulkAction(value: string): value is BulkAction {
  return BULK_ACTION_VALUES.has(value);
}

export interface AccessTransition {
  /** The partial `profiles` update to apply. */
  update: Record<string, unknown>;
  /** The moderation_logs action string to audit. */
  moderationAction: ModerationAction;
  /** Whether a "you're in" approval email is appropriate for this transition. */
  sendApprovalEmail: boolean;
}

/**
 * Map a bulk action onto the concrete column changes + audit action.
 *
 * KAN-326: the clean axes (user_status, access_tier) are the source of truth.
 * The legacy columns (access_stage, early_access, is_beta_eligible,
 * beta_access_status) are written together in lockstep until they're dropped in
 * the follow-up migration, so the model and the gate can never drift. `now` and
 * `reason` are passed in to keep this function pure (no Date.now / no I/O).
 */
export function computeAccessTransition(
  action: BulkAction,
  opts: { now: string; reason?: string | null },
): AccessTransition {
  switch (action) {
    case 'enable_beta':
      return {
        update: {
          user_status: 'live',
          access_tier: 'beta',
          access_stage: 'beta',
          early_access: true,
          is_beta_eligible: true,
          beta_access_status: 'approved',
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
          access_stage: 'waitlist',
          early_access: false,
          is_beta_eligible: false,
          beta_access_status: 'none',
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
          access_stage: 'live',
          early_access: true,
          is_beta_eligible: true,
          beta_access_status: 'approved',
        },
        moderationAction: 'promote_live',
        sendApprovalEmail: true,
      };
    case 'promote_live_no_beta':
      return {
        update: {
          user_status: 'live',
          access_tier: 'prod',
          access_stage: 'live',
          early_access: false,
          // Still beta-eligible so the launched user passes the enforced gate;
          // early_access=false is the "no experimental features" switch.
          is_beta_eligible: true,
          beta_access_status: 'approved',
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

/** Parsed shape of the filter posted by "select all matching filter". */
export interface UserFilter {
  search: string | null;
  stage: string | null;
  early: boolean | null;
  suspended: boolean | null;
  admin: boolean | null;
}
