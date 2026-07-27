/**
 * KAN-309 (epic) / KAN-311: pure helpers + constants for the user-management
 * console's bulk actions.
 *
 * This file is NOT 'use server' — it holds the runtime constants and types so
 * the action module (`actions.ts`) can stay async-only (BUGS-12: a 'use server'
 * file may only export async functions).
 *
 * KAN-424 (F2): the transition matrix itself (`computeAccessTransition`,
 * `AccessTransition`) moved OUT of this admin route tree to `@/lib/access-model`
 * — it is access policy, not an admin-console detail, and living here made it
 * the codebase's only lib -> app import edge. What remains is genuinely admin's:
 * the console's menu, its caps, and its filter shape.
 */

import type { AccessAction } from '@/lib/access-model';

/** Hard ceiling on a single bulk action (server-enforced). */
export const BULK_MAX = 500;

/** Max approval emails to send per bulk action (best-effort, bounded). */
export const EMAIL_CAP = 100;

export interface BulkActionConfig {
  value: AccessAction;
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

/** Parsed shape of the filter posted by "select all matching filter". */
export interface UserFilter {
  search: string | null;
  stage: string | null;
  early: boolean | null;
  suspended: boolean | null;
  admin: boolean | null;
}
