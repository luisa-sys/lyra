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

import { createClient as createSupabaseServerClient } from '@/modules/platform/supabase-server';
import { createServiceRoleClient } from '@/modules/platform/supabase-service';
import type { Database, Json } from '@/types/database';

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
  | 'enable_beta' // waitlist -> beta (user_status=live, access_tier=beta)
  | 'disable_beta' // beta -> waitlist (user_status=waitlist, access_tier=beta)
  | 'promote_live' // promote to the launched product (user_status=live, access_tier=prod)
  // KAN-309 follow-on: per-user feature entitlement toggles
  | 'enable_feature'
  | 'disable_feature'
  // KAN-319: admin publish-state control (unpublish keeps owner edit, hides public)
  | 'unpublish'
  | 'republish'
  // KAN-319: admin override of age-verification status (e.g. manual_review/exempt)
  | 'set_age_status'
  // KAN-408: environment-scoped global feature switch (env recorded in metadata)
  | 'enable_global_feature'
  | 'disable_global_feature';

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
  return createServiceRoleClient();
}

/**
 * SEC-132: the generated Insert row for `moderation_logs`. Named once here
 * because both writers below have to state the same trigger-managed omission.
 */
type ModerationLogInsert = Database['public']['Tables']['moderation_logs']['Insert'];

export interface LogModerationActionInput {
  admin: AdminUser;
  action: ModerationAction;
  targetProfileId?: string | null;
  targetItemId?: string | null;
  reason?: string | null;
  /**
   * SEC-132: `Json`, not `Record<string, unknown>`. This value is written to a
   * `jsonb` column, and `unknown` values are not necessarily serialisable — a
   * `Date`, a `Map` or a `undefined` survives `Record<string, unknown>` and
   * then lands in the audit log as `{}` or an error.
   */
  metadata?: Json;
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
  // SEC-132: `row_hash` / `seq` omitted deliberately — see the note in
  // logModerationActionsBatch below. They are written by the hash-chain trigger,
  // and a caller able to supply its own would be able to forge the audit chain.
  const row: Omit<ModerationLogInsert, 'row_hash' | 'seq'> = {
    actor_user_id: input.admin.userId,
    action: input.action,
    target_profile_id: input.targetProfileId ?? null,
    target_item_id: input.targetItemId ?? null,
    reason: input.reason ?? null,
    metadata: input.metadata ?? {},
  };
  const { data, error } = await client
    .from('moderation_logs')
    .insert(row as ModerationLogInsert)
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
  /** SEC-132: see the note on `LogModerationActionInput.metadata`. */
  metadata?: Json;
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
  // SEC-132: `row_hash` and `seq` are NOT NULL with no column default, so the
  // generated Insert type marks them REQUIRED. Supplying them from here would
  // be wrong, not merely redundant: they are computed by the BEFORE INSERT
  // trigger `moderation_logs_hash_chain_trg`, which is what makes this table
  // tamper-evident. A caller that could set its own `row_hash` could forge the
  // chain. Typegen cannot see triggers, so this is the one place the generated
  // type is narrower than the database — the omission is named in an `Omit`
  // rather than hidden behind a blanket cast, so the other columns stay checked.
  const rows: Omit<ModerationLogInsert, 'row_hash' | 'seq'>[] = input.targetProfileIds.map(
    (profileId) => ({
      actor_user_id: input.admin.userId,
      action: input.action,
      target_profile_id: profileId,
      target_item_id: null,
      reason: input.reason ?? null,
      metadata: input.metadata ?? {},
    }),
  );
  const { error } = await client
    .from('moderation_logs')
    .insert(rows as ModerationLogInsert[]);
  if (error) {
    throw new Error(`Failed to write ${rows.length} moderation_logs rows: ${error.message}`);
  }
}
