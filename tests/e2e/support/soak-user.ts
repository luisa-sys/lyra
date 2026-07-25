/**
 * KAN-412 — the PERSISTENT soak user for the daily Staging Soak routine.
 *
 * Unlike the KAN-348 authed harness (seed-user.ts), which delete+recreates six
 * users every run, the soak deliberately keeps ONE account provisioned "in
 * advance" and resets only its DERIVED state back to initial account-setup each
 * run. Rationale (per the routine design): the daily soak must NOT test user
 * creation — that is the un-skippable promotion gate (docs/SIGNUP_SURFACE_GATE.md)
 * — it must test everything a real, already-signed-up user does afterwards.
 *
 * `ensureSoakUser()`   — idempotently provision the account if it is absent
 *                        (the "created in advance" step; a no-op once it exists).
 * `resetSoakUserToInitial()` — restore the profile + purge derived rows so the
 *                        account is back at initial account setup, WITHOUT
 *                        deleting the auth user (the account persists).
 * `assertInitialBaseline()`  — verify the reset actually left a clean slate; the
 *                        journey FAILS loudly if any row survives, because that
 *                        means the reset table-list below is stale for a table a
 *                        release started writing to (part of the release
 *                        contract in docs/STAGING_SOAK_ROUTINE.md §C3).
 *
 * All privileged writes go through the service-role admin client, which
 * hard-guards against prod and only allows the dev/staging refs
 * (supabase-admin.ts). There is no prod path: the service-role key is absent in
 * the prod app runtime.
 */
import { adminClient } from './supabase-admin';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Fixed seed-convention email so the account is stable + cleanup is targeted. */
export const SOAK_EMAIL = 'soak@seed.checklyra.com';
export const SOAK_DISPLAY_NAME = 'Soak Test User';

export interface SoakUser {
  userId: string;
  profileId: string;
  slug: string;
  email: string;
}

/**
 * DERIVED tables the journey writes to, purged on reset. This list IS part of
 * the release contract: when a release makes the post-signup journey write to a
 * new per-profile table, add it here (and assertInitialBaseline will catch the
 * omission by failing on left-behind rows). Each entry is {table, column}.
 */
const DERIVED_PROFILE_TABLES: ReadonlyArray<{ table: string; column: string }> = [
  { table: 'profile_items', column: 'profile_id' },
  { table: 'school_affiliations', column: 'profile_id' },
  { table: 'feature_entitlements', column: 'profile_id' },
];

async function findUserIdByEmail(admin: SupabaseClient, email: string): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match.id;
    if (data.users.length < 200) break;
  }
  return null;
}

/** Provision the soak account if it does not yet exist. Idempotent. */
export async function ensureSoakUser(): Promise<SoakUser> {
  const admin = adminClient();

  let userId = await findUserIdByEmail(admin, SOAK_EMAIL);
  if (!userId) {
    const { data: created, error } = await admin.auth.admin.createUser({
      email: SOAK_EMAIL,
      email_confirm: true,
      user_metadata: { full_name: SOAK_DISPLAY_NAME },
    });
    if (error || !created?.user) throw new Error(`createUser(${SOAK_EMAIL}) failed: ${error?.message}`);
    userId = created.user.id;

    // GoTrue NULL-token quirk (CLAUDE.md): admin-created users get NULL token
    // columns that later 500 on generateLink. Repair via the dev/staging-only
    // SECURITY DEFINER helper (20260704120000_e2e_fix_auth_tokens_fn.sql).
    const { error: fixErr } = await admin.rpc('e2e_fix_auth_tokens', { uid: userId });
    if (fixErr) {
      throw new Error(
        `e2e_fix_auth_tokens(${userId}) failed: ${fixErr.message}. ` +
          'Has 20260704120000_e2e_fix_auth_tokens_fn.sql been applied to staging?',
      );
    }
  }

  const { data: profileRow, error: profErr } = await admin
    .from('profiles')
    .select('id,slug')
    .eq('user_id', userId)
    .single();
  if (profErr || !profileRow) throw new Error(`profile fetch for ${SOAK_EMAIL} failed: ${profErr?.message}`);

  return { userId, profileId: profileRow.id as string, slug: profileRow.slug as string, email: SOAK_EMAIL };
}

/**
 * Reset the persistent soak user to INITIAL ACCOUNT SETUP: name-only, not
 * published, 18+ declared (the login gate), no derived content. Does NOT delete
 * the auth user — the account persists across runs.
 */
export async function resetSoakUserToInitial(user: SoakUser): Promise<void> {
  const admin = adminClient();

  // Purge derived per-profile rows first (order-independent; all keyed by profile).
  for (const { table, column } of DERIVED_PROFILE_TABLES) {
    const { error } = await admin.from(table).delete().eq(column, user.profileId);
    if (error) throw new Error(`reset: delete from ${table} failed: ${error.message}`);
  }

  // Restore the profile row to the initial baseline.
  const { error: updErr } = await admin
    .from('profiles')
    .update({
      display_name: SOAK_DISPLAY_NAME,
      bio_short: null,
      is_published: false,
      user_status: 'live', // staging middleware lets a live/beta user reach /dashboard
      access_tier: 'beta',
      // 18+ self-declaration is the login gate (KAN-407) — set so the user can
      // reach /dashboard; this is orthogonal to the provider age_status gate.
      age_declared_18_at: new Date().toISOString(),
      age_status: 'none',
      age_checked_at: null,
      age_provider: null,
      age_range: null,
      dashboard_widget_state: {},
    })
    .eq('id', user.profileId);
  if (updErr) throw new Error(`reset: profile update failed: ${updErr.message}`);
}

/**
 * Verify the reset left a genuinely clean initial slate. Returns a list of
 * violations (empty === clean). The journey turns a non-empty result into a
 * loud FAIL so a stale DERIVED_PROFILE_TABLES list can never masquerade as a
 * passing soak (no-silent-skip).
 */
export async function assertInitialBaseline(user: SoakUser): Promise<string[]> {
  const admin = adminClient();
  const violations: string[] = [];

  for (const { table, column } of DERIVED_PROFILE_TABLES) {
    const { count, error } = await admin
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq(column, user.profileId);
    if (error) {
      violations.push(`could not verify ${table}: ${error.message}`);
    } else if ((count ?? 0) > 0) {
      violations.push(`${table} still has ${count} row(s) after reset`);
    }
  }

  const { data: prof, error: profErr } = await admin
    .from('profiles')
    .select('is_published,bio_short,age_declared_18_at')
    .eq('id', user.profileId)
    .single();
  if (profErr || !prof) {
    violations.push(`could not verify profile baseline: ${profErr?.message}`);
  } else {
    if (prof.is_published) violations.push('profile.is_published is still true after reset');
    if (prof.bio_short) violations.push('profile.bio_short is still set after reset');
    if (!prof.age_declared_18_at) violations.push('profile.age_declared_18_at missing (login gate would block)');
  }

  return violations;
}
