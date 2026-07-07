/**
 * KAN-348 — deterministic test-user seeding for the authenticated E2E harness.
 *
 * `seedJourneyUser(state)` idempotently provisions a FIXED-email test user in
 * the target (dev/staging) Supabase and drives its profile signals to the exact
 * onboarding state the journey spec asserts. Runs are idempotent: an existing
 * seed user is deleted (profile cascades) and recreated, so every run starts
 * from a deterministic clean slate.
 *
 * All privileged writes go through the service-role admin client, so they run
 * with `auth.uid() IS NULL` and are permitted past the KAN-326
 * `prevent_beta_self_elevation` / feature-entitlement self-grant guards — no
 * prod bypass, since the service-role key is absent in the prod app runtime.
 *
 * State model (mirrors src/lib/dashboard/resolve-widgets.ts +
 * docs/DEV_E2E_REGRESSION.md §2):
 *   empty              — not published, completion < 40 (name only)
 *   drafted            — not published, completion >= 40 (name + short intro)
 *   published_activate — published, missing gifts OR affiliations
 *   published_grow     — published, has a gift AND an affiliation
 *   no_convene         — published_activate-style but explicitly convene-off
 *   age_none           — name + intro but age_status='none' (age-gate sub-case)
 */
import { adminClient } from './supabase-admin';
import type { SupabaseClient } from '@supabase/supabase-js';

export type JourneyState =
  | 'empty'
  | 'drafted'
  | 'published_activate'
  | 'published_grow'
  | 'no_convene'
  | 'age_none';

export interface SeededUser {
  state: JourneyState;
  userId: string;
  email: string;
  profileId: string;
  slug: string;
}

/** Fixed, seed-convention email so runs are idempotent + cleanup is targeted. */
export function emailForState(state: JourneyState): string {
  return `seed.e2e.${state}@seed.checklyra.com`;
}

async function findUserIdByEmail(admin: SupabaseClient, email: string): Promise<string | null> {
  // listUsers is paged; the seed emails are few, so a small scan is fine.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match.id;
    if (data.users.length < 200) break; // last page
  }
  return null;
}

/** Drive the six onboarding states via service-role UPDATEs / inserts. */
export async function seedJourneyUser(state: JourneyState): Promise<SeededUser> {
  const admin = adminClient();
  const email = emailForState(state);

  // (1) Idempotent clean slate: delete any existing user (profile cascades).
  const existing = await findUserIdByEmail(admin, email);
  if (existing) {
    const { error } = await admin.auth.admin.deleteUser(existing);
    if (error) throw new Error(`deleteUser(${email}) failed: ${error.message}`);
  }

  // (2) Create the auth user (email pre-confirmed so magic-link mint works).
  const fullName = `E2E ${state.replace(/_/g, ' ')} User`;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (createErr || !created?.user) {
    throw new Error(`createUser(${email}) failed: ${createErr?.message}`);
  }
  const userId = created.user.id;

  // (3) GoTrue NULL-token quirk: admin-created users get NULL confirmation /
  // recovery token columns, which later 500 with "converting NULL to string is
  // unsupported" on token ops (generateLink). Repair via the dev/staging-only
  // SECURITY DEFINER helper added in 20260704120000_e2e_fix_auth_tokens_fn.sql.
  const { error: fixErr } = await admin.rpc('e2e_fix_auth_tokens', { uid: userId });
  if (fixErr) {
    throw new Error(
      `e2e_fix_auth_tokens(${userId}) failed: ${fixErr.message}. ` +
        'Has 20260704120000_e2e_fix_auth_tokens_fn.sql been applied to this dev/staging project?',
    );
  }

  // (4) handle_new_user already created the profiles row — fetch it.
  const { data: profileRow, error: profErr } = await admin
    .from('profiles')
    .select('id,slug')
    .eq('user_id', userId)
    .single();
  if (profErr || !profileRow) {
    throw new Error(`profile fetch for ${email} failed: ${profErr?.message}`);
  }
  const profileId = profileRow.id as string;
  const slug = profileRow.slug as string;

  // (5) Access lifecycle + age. `live`/`beta` so dev/stage middleware lets the
  // user reach /dashboard; age_status='passed' EXCEPT for the age_none sub-case.
  const passesAge = state !== 'age_none';
  const displayName = fullName;
  // intro fields: everything except 'empty' gets a short intro so read-time
  // completion crosses 40 (name 20% + intro 20%). 'empty' stays name-only (<40).
  const bioShort = state === 'empty' ? null : 'A short intro so this profile reads as drafted.';
  const isPublished =
    state === 'published_activate' || state === 'published_grow' || state === 'no_convene';

  const { error: updErr } = await admin
    .from('profiles')
    .update({
      display_name: displayName,
      bio_short: bioShort,
      user_status: 'live',
      access_tier: 'beta',
      age_status: passesAge ? 'passed' : 'none',
      age_checked_at: passesAge ? new Date().toISOString() : null,
      age_provider: passesAge ? 'manual' : null,
      age_range: passesAge ? '30_44' : null,
      is_published: isPublished,
      // Deterministic dismissal baseline for every seed.
      dashboard_widget_state: {},
    })
    .eq('id', profileId);
  if (updErr) throw new Error(`profile update for ${email} failed: ${updErr.message}`);

  // Clean any prior content rows (idempotency belt-and-braces; a fresh delete+
  // create means there shouldn't be any, but keep it deterministic).
  await admin.from('profile_items').delete().eq('profile_id', profileId).eq('category', 'gift_ideas');
  await admin.from('school_affiliations').delete().eq('profile_id', profileId);
  await admin.from('feature_entitlements').delete().eq('profile_id', profileId).eq('feature_key', 'convene');

  // published_grow needs BOTH a gift and an affiliation (→ resolves to _grow).
  if (state === 'published_grow') {
    const { error: giftErr } = await admin.from('profile_items').insert({
      profile_id: profileId,
      category: 'gift_ideas',
      title: 'A good book',
    });
    if (giftErr) throw new Error(`gift insert for ${email} failed: ${giftErr.message}`);
    const { error: affErr } = await admin.from('school_affiliations').insert({
      profile_id: profileId,
      school_name: 'Greenfield Primary',
    });
    if (affErr) throw new Error(`affiliation insert for ${email} failed: ${affErr.message}`);
  }

  // (6) Entitlements. Only published_grow gets convene (so W6 renders there);
  // published_activate / no_convene leave it default-off so W6 must NOT render.
  if (state === 'published_grow') {
    const { error: entErr } = await admin.from('feature_entitlements').insert({
      profile_id: profileId,
      feature_key: 'convene',
      enabled: true,
    });
    if (entErr) throw new Error(`convene entitlement for ${email} failed: ${entErr.message}`);
  }

  return { state, userId, email, profileId, slug };
}
