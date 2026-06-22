/**
 * KAN-141: admin auth + moderation helpers.
 *
 * Single source of truth for "is the current user an admin?" and the
 * "do a moderation action + write an audit log row atomically" pattern.
 *
 * Two design rules baked in here:
 *
 *   1. The admin gate goes through the DB on every request. Caching the
 *      admin flag in a JWT claim would be faster but would let an admin
 *      who's been revoked keep their privileges until token refresh.
 *      Reads are cheap (single-row, partial-indexed lookup), correctness
 *      is non-negotiable.
 *
 *   2. Every moderation action MUST go through `logModerationAction` so
 *      the audit table reflects reality. The helper writes the log row
 *      first (using the service-role client) — if the subsequent
 *      mutation fails, we still have the attempt logged for forensics.
 *      A failed-but-logged action is a smaller hazard than a successful-
 *      but-unlogged one.
 */

import { createClient as createSupabaseServerClient } from '@/lib/supabase-server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

/**
 * The set of action strings we accept in moderation_logs. The DB column
 * is `text` (not enum) so we can add new actions without a migration,
 * but the application validates here so we don't accidentally log typos.
 *
 * - suspend / unsuspend       — profile-level
 * - delete_item / restore_item — item-level (restore_item is theoretical;
 *                                items are hard-deleted today)
 * - warn                      — soft action (email only, no state change)
 * - resolve_report / dismiss_report — report-state transitions
 * - grant_admin / revoke_admin — change admin flag on another user
 */
export type ModerationAction =
  | 'suspend'
  | 'unsuspend'
  | 'delete_item'
  | 'restore_item'
  | 'warn'
  | 'resolve_report'
  | 'dismiss_report'
  | 'grant_admin'
  | 'revoke_admin'
  | 'grant_beta_access' // KAN-273: approve a queued user into the beta
  // KAN-309: two-axis access model transitions from the user-management console
  | 'enable_beta' // waitlist -> beta (also sets is_beta_eligible=true)
  | 'disable_beta' // beta -> waitlist (revokes is_beta_eligible)
  | 'promote_live'; // promote to the launched product (± early_access)

export interface AdminUser {
  userId: string;
  profileId: string;
  email: string | null;
  displayName: string | null;
}

/**
 * Returns the current admin user if-and-only-if the cookie-authenticated
 * session is a real admin. Null otherwise. Never throws — the caller
 * decides how to respond (rewrite to 404, redirect to login, return 403).
 *
 * The deliberate choice of `notFound()` over `403` in the route handlers
 * is in `src/middleware.ts` — this helper just answers "is admin or no".
 */
export async function getCurrentAdmin(): Promise<AdminUser | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, display_name, is_admin')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error || !profile?.is_admin) return null;

  return {
    userId: user.id,
    profileId: profile.id,
    email: user.email ?? null,
    displayName: profile.display_name as string | null,
  };
}

/**
 * Service-role client. Used by admin actions that need to bypass RLS
 * (e.g. listing every report regardless of reporter). The function is
 * exported so route handlers can compose it directly; callers should
 * already have verified the requester is an admin before reaching here.
 */
export function getAdminServiceClient() {
  return createServiceClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false },
  });
}

export interface LogModerationActionInput {
  admin: AdminUser;
  action: ModerationAction;
  targetProfileId?: string | null;
  targetItemId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Inserts a single moderation log row. Returns the inserted row id so
 * callers can correlate it with their downstream mutation.
 *
 * Throws if the insert fails — callers should let the error propagate
 * to the route handler, which converts it to a 500. We DO NOT
 * swallow log failures: a moderation action that we couldn't audit is
 * a moderation action we shouldn't have committed.
 */
export async function logModerationAction(input: LogModerationActionInput): Promise<string> {
  const client = getAdminServiceClient();
  const { data, error } = await client
    .from('moderation_logs')
    .insert({
      actor_user_id: input.admin.userId,
      action: input.action,
      target_profile_id: input.targetProfileId ?? null,
      target_item_id: input.targetItemId ?? null,
      reason: input.reason ?? null,
      metadata: input.metadata ?? {},
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Failed to write moderation_logs row: ${error?.message ?? 'unknown error'}`);
  }
  return data.id as string;
}

export interface LogModerationActionsBatchInput {
  admin: AdminUser;
  action: ModerationAction;
  targetProfileIds: string[];
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * KAN-309: audit a bulk admin action — one moderation_logs row per affected
 * profile, written in a single insert. Used by the user-management console's
 * bulk actions. Same audit-first contract as logModerationAction: throws if
 * the insert fails so the caller aborts the mutation (a bulk action we
 * couldn't audit is one we shouldn't commit).
 */
export async function logModerationActionsBatch(
  input: LogModerationActionsBatchInput,
): Promise<void> {
  if (input.targetProfileIds.length === 0) return;
  const client = getAdminServiceClient();
  const rows = input.targetProfileIds.map((profileId) => ({
    actor_user_id: input.admin.userId,
    action: input.action,
    target_profile_id: profileId,
    target_item_id: null,
    reason: input.reason ?? null,
    metadata: input.metadata ?? {},
  }));
  const { error } = await client.from('moderation_logs').insert(rows);
  if (error) {
    throw new Error(`Failed to write ${rows.length} moderation_logs rows: ${error.message}`);
  }
}
