'use server';

import { createClient } from '@/modules/platform/supabase-server';
import { revalidatePath } from 'next/cache';
import { sanitiseText, sanitiseUrl, type ActionResult } from '@/modules/guards/sanitise';
import { moderateAndAudit } from '@/lib/moderation-audit';
import type { WizardItem } from './steps/types';
import { checkProfileWriteRateLimit } from '@/modules/guards/profile-rate-limit';
import { getMyFeatureEntitlements } from '@/modules/features/entitlements';
import { isProviderAgeCheckActive, passedProviderAgeCheck, AGE_GATE_BLOCK_MESSAGE } from '@/modules/age/provider-gate';
import { isAllowedProfileField } from './profile-fields';
import { coerceVisibility } from './visibility';
import { coerceAffiliationType, requiresPostcode, isSchoolPostcodeValid } from './affiliation-fields';
import {
  coerceSectionVisibility,
  isControllableSectionKey,
  type SectionVisibility,
} from './section-visibility';
import { preflightUpload } from '@/modules/guards/file-magic-bytes';
import { MAX_SUGGESTION_KEY_LENGTH } from '@/lib/recommend/dismissals';
import { dbErrorFor } from '@/lib/db-error-copy';

async function getAuthenticatedUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, supabase, error: 'Not authenticated' as const };
  return { user, supabase, error: null };
}

async function getUserProfile(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', userId)
    .single();
  return profile;
}

// The allowlist (ALLOWED_PROFILE_FIELDS, AllowedProfileField, isAllowedProfileField)
// lives in ./profile-fields — Next.js 16+ rejects non-async-function exports from
// `'use server'` files at action-invocation time. See BUGS-12.

// KAN-167 / CodeQL alert #2: the previous `updateProfile(formData)` function
// was DEAD CODE (zero callers in src/) AND had a remote property injection
// vulnerability — it accepted a `field` name from FormData and wrote
// `{ [field]: value }` to the profiles table, allowing an authenticated user
// to write to ANY column on their own row including `is_published`,
// `completion_score`, `created_at`, etc. Deleted rather than fixed because
// no caller exists. If a single-field update API is needed in the future,
// reintroduce it using `updateProfileFields({ [field]: value })` so the
// allowlist applies.

export async function updateProfileFields(data: Record<string, string | boolean | number | null>): Promise<ActionResult> {
  const { user, supabase, error: authError } = await getAuthenticatedUser();
  if (authError) return { success: false, error: authError };

  // KAN-231 — profile-save rate limiting (KAN-63 Tier 2-D).
  const rl = await checkProfileWriteRateLimit(user!.id);
  if (!rl.allowed) return rl.result;

  // Reject any key not in the allowlist — prevents remote property injection.
  // We collect rejected keys rather than failing on the first one so the
  // error message is useful for debugging legitimate callers.
  const rejected: string[] = [];
  const sanitised: Record<string, string | boolean | number | null> = {};
  for (const [key, val] of Object.entries(data)) {
    if (!isAllowedProfileField(key)) {
      rejected.push(key);
      continue;
    }
    // BUGS-74 — "not provided" and "explicitly cleared" are different things:
    //   undefined     → OMIT the key entirely, leaving the stored value alone
    //   null / string → an explicit write (null clears the column)
    // Until now this held only by accident: `undefined` was copied into the
    // payload and happened to be dropped by JSON serialisation on the way to
    // PostgREST. A single `?? null` would have turned every omitted field into
    // a silent wipe — the exact mechanism that destroyed members' Manual-of-Me
    // text. Make it explicit so the contract is asserted, not incidental.
    // Guarded by scripts/check-partial-write-safety.py + the runtime contract
    // cases in tests/unit/partial-write-safety.test.ts.
    if (val === undefined) continue;
    sanitised[key] = typeof val === 'string' ? sanitiseText(val) : val;
  }

  if (rejected.length > 0) {
    return {
      success: false,
      error: `Field(s) not permitted: ${rejected.join(', ')}`,
    };
  }

  // KAN-241 — content moderation, KAN-244 — audit-log every flagged event.
  // Runs AFTER sanitiseText so the moderator sees the post-strip text
  // (a profanity inside <script>profanity</script> gets stripped to plain
  // `profanity` first, then caught). All `profiles` fields are 'public'.
  const profile = await getUserProfile(supabase, user!.id);
  const profileId = profile?.id ?? null;
  for (const [key, val] of Object.entries(sanitised)) {
    if (typeof val !== 'string') continue;
    const mod = await moderateAndAudit(supabase, {
      text: val,
      fieldType: 'public',
      field: `profiles.${key}`,
      profileId,
      source: 'web_app',
    });
    if (!mod.ok) {
      return { success: false, error: mod.error };
    }
  }

  // If after filtering there's nothing to write, treat as a no-op success
  // rather than firing a meaningless UPDATE with empty SET.
  if (Object.keys(sanitised).length === 0) {
    return { success: true };
  }

  // KAN-408: `is_published` is allow-listed, so this is a second publish path.
  // Apply the same provider age gate as publishProfile() when the environment's
  // `age_verification` switch is ON, so it can't be bypassed. (Un-publishing —
  // is_published=false — is always allowed.)
  if (sanitised.is_published === true && (await isProviderAgeCheckActive())) {
    const { data: ageRow } = await supabase
      .from('profiles')
      .select('age_status')
      .eq('user_id', user!.id)
      .maybeSingle();
    if (!passedProviderAgeCheck((ageRow as { age_status?: string } | null)?.age_status)) {
      return { success: false, error: AGE_GATE_BLOCK_MESSAGE };
    }
  }

  const { error } = await supabase
    .from('profiles')
    .update(sanitised)
    .eq('user_id', user!.id);

  if (error) return { success: false, error: dbErrorFor('update-profile-fields', error) };
  revalidatePath('/dashboard/profile');
  return { success: true };
}

export async function addProfileItem(data: {
  category: string;
  title: string;
  description?: string;
  url?: string;
  visibility?: string;
  // KAN-444 — the member's own heading for a custom favourites group. Public
  // text, so it is sanitised and moderated exactly like a title.
  groupLabel?: string;
}): Promise<ActionResult> {
  const { user, supabase, error: authError } = await getAuthenticatedUser();
  if (authError) return { success: false, error: authError };

  // KAN-231 — profile-save rate limiting.
  const rl = await checkProfileWriteRateLimit(user!.id);
  if (!rl.allowed) return rl.result;

  const profile = await getUserProfile(supabase, user!.id);
  if (!profile) return { success: false, error: 'Profile not found' };

  // KAN-219 — optional URL on items (Python `lyra-app` parity). If absent or
  // empty, insert NULL. If provided, `sanitiseUrl` returns '' on anything
  // that's not http(s) — surface that as an error rather than silently
  // dropping the field so the user knows their input was rejected.
  let sanitisedUrl: string | null = null;
  if (data.url && data.url.trim() !== '') {
    const cleaned = sanitiseUrl(data.url);
    if (!cleaned) {
      return { success: false, error: 'Invalid URL — must start with http:// or https://' };
    }
    sanitisedUrl = cleaned;
  }

  // KAN-234: empty / null / undefined visibility → NULL in the DB, which
  // means "inherit from section default" per the hybrid visibility model
  // (see section-visibility.ts → getEffectiveItemVisibility). Otherwise
  // coerce to one of the three real values (KAN-143).
  const visibility = data.visibility && data.visibility !== ''
    ? coerceVisibility(data.visibility)
    : null;

  // KAN-241 + KAN-244 — content moderation + audit log on item text fields.
  const sanitisedTitle = sanitiseText(data.title, 200);
  const sanitisedDesc = data.description
    ? sanitiseText(data.description, 1000)
    : null;
  const titleMod = await moderateAndAudit(supabase, {
    text: sanitisedTitle,
    fieldType: 'public',
    field: 'profile_items.title',
    profileId: profile.id,
    source: 'web_app',
  });
  if (!titleMod.ok) return { success: false, error: titleMod.error };
  if (sanitisedDesc) {
    const descMod = await moderateAndAudit(supabase, {
      text: sanitisedDesc,
      fieldType: 'public',
      field: 'profile_items.description',
      profileId: profile.id,
      source: 'web_app',
    });
    if (!descMod.ok) return { success: false, error: descMod.error };
  }

  // KAN-444 — a member-named favourites group. The heading is shown on the
  // public profile, so it goes through the same sanitise + moderation path
  // as the item's own text rather than straight into the row.
  const sanitisedGroupLabel = data.groupLabel && data.groupLabel.trim() !== ''
    ? sanitiseText(data.groupLabel, 60)
    : null;
  if (sanitisedGroupLabel) {
    const groupMod = await moderateAndAudit(supabase, {
      text: sanitisedGroupLabel,
      fieldType: 'public',
      field: 'profile_items.group_label',
      profileId: profile.id,
      source: 'web_app',
    });
    if (!groupMod.ok) return { success: false, error: groupMod.error };
  }

  // Only send group_label when there is one. PostgREST builds the INSERT
  // column list from the payload keys, so an unknown key fails the WHOLE
  // request with PGRST204 even when the value is null — which would break
  // every add path here (9 editor sections + 6 legacy wizard steps) on any
  // environment where 20260803114500_favourites_custom_group.sql has not run
  // yet. Omitting the key keeps existing adds byte-identical to before, so
  // only the new add-your-own path depends on the new column.
  const { error } = await supabase
    .from('profile_items')
    .insert({
      profile_id: profile.id,
      category: sanitiseText(data.category, 50),
      title: sanitisedTitle,
      description: sanitisedDesc,
      url: sanitisedUrl,
      visibility,
      ...(sanitisedGroupLabel ? { group_label: sanitisedGroupLabel } : {}),
    });

  if (error) return { success: false, error: dbErrorFor('add-profile-item', error) };
  revalidatePath('/dashboard/profile');
  return { success: true };
}

export async function updateProfileItemVisibility(
  itemId: string,
  visibility: string,
): Promise<ActionResult> {
  const { user, supabase, error: authError } = await getAuthenticatedUser();
  if (authError) return { success: false, error: authError };

  // KAN-260 — belt-and-braces ownership: scope the write to the caller's
  // own profile in code, not by RLS alone, so an item that isn't yours can
  // never be edited even if a DB policy were ever misconfigured.
  const profile = await getUserProfile(supabase, user!.id);
  if (!profile) return { success: false, error: 'Profile not found' };

  // KAN-234: empty string → NULL = "inherit from section default" (hybrid
  // visibility model). Otherwise coerce to one of the three real values.
  const visibilityValue = visibility && visibility !== ''
    ? coerceVisibility(visibility)
    : null;

  const { error } = await supabase
    .from('profile_items')
    .update({ visibility: visibilityValue })
    .eq('id', itemId)
    .eq('profile_id', profile.id);

  if (error) return { success: false, error: dbErrorFor('update-profile-item-visibility', error) };
  revalidatePath('/dashboard/profile');
  return { success: true };
}

// KAN-404 (#12) — richer result for updateProfileItem so the inline editor
// can optimistically show the saved row. Additive union: existing callers
// that only read `.success`/`.error` are unaffected.
export type ItemActionResult =
  | { success: true; item: WizardItem }
  | { success: false; error: string };

/**
 * KAN-404 (#12) — edit an existing profile item's text (title / description /
 * url). Mirrors `addProfileItem` for sanitise + moderation, and
 * `updateProfileItemVisibility` for owner-scoping (KAN-260). Only the fields
 * the caller passes are updated; an empty description clears it to NULL and an
 * empty url clears it to NULL, so a user can remove a description/link via
 * edit, not only replace it. Category is intentionally NOT editable here
 * (text-only edit — changing category is a separate concern).
 */
export async function updateProfileItem(
  itemId: string,
  data: { title?: string; description?: string; url?: string },
): Promise<ItemActionResult> {
  const { user, supabase, error: authError } = await getAuthenticatedUser();
  if (authError) return { success: false, error: authError };

  // KAN-231 — profile-save rate limiting (edits are user-driven writes too).
  const rl = await checkProfileWriteRateLimit(user!.id);
  // A rate-limit block is always a failure; narrow to the failure shape so it
  // fits ItemActionResult (which requires `item` on success).
  if (!rl.allowed) {
    return { success: false, error: 'error' in rl.result ? rl.result.error : 'Too many changes, please slow down.' };
  }

  // KAN-260 — belt-and-braces ownership: scope the write to the caller's own
  // profile in code, not by RLS alone.
  const profile = await getUserProfile(supabase, user!.id);
  if (!profile) return { success: false, error: 'Profile not found' };

  // Build the partial update only from the fields the caller passed, matching
  // addProfileItem's sanitise + per-field moderation exactly.
  const updates: Record<string, string | null> = {};

  if (data.title !== undefined) {
    const sanitisedTitle = sanitiseText(data.title, 200);
    const titleMod = await moderateAndAudit(supabase, {
      text: sanitisedTitle,
      fieldType: 'public',
      field: 'profile_items.title',
      profileId: profile.id,
      source: 'web_app',
    });
    if (!titleMod.ok) return { success: false, error: titleMod.error };
    updates.title = sanitisedTitle;
  }

  if (data.description !== undefined) {
    // Empty string clears the description to NULL (mirrors the add path).
    const sanitisedDesc = data.description.trim() !== ''
      ? sanitiseText(data.description, 1000)
      : null;
    if (sanitisedDesc) {
      const descMod = await moderateAndAudit(supabase, {
        text: sanitisedDesc,
        fieldType: 'public',
        field: 'profile_items.description',
        profileId: profile.id,
        source: 'web_app',
      });
      if (!descMod.ok) return { success: false, error: descMod.error };
    }
    updates.description = sanitisedDesc;
  }

  if (data.url !== undefined) {
    // Empty → NULL; non-empty must pass sanitiseUrl (http(s) only), same as add.
    if (data.url.trim() === '') {
      updates.url = null;
    } else {
      const cleaned = sanitiseUrl(data.url);
      if (!cleaned) {
        return { success: false, error: 'Invalid URL — must start with http:// or https://' };
      }
      updates.url = cleaned;
    }
  }

  // Empty-patch guard — no-op rather than firing an UPDATE with empty SET.
  // Re-read the row so the caller still gets the current item back.
  if (Object.keys(updates).length === 0) {
    const { data: current, error: readErr } = await supabase
      .from('profile_items')
      .select('id, category, title, description, url, visibility')
      .eq('id', itemId)
      .eq('profile_id', profile.id)
      .single();
    if (readErr || !current) return { success: false, error: readErr?.message ?? 'Item not found' };
    return { success: true, item: current as WizardItem };
  }

  const { data: row, error } = await supabase
    .from('profile_items')
    .update(updates)
    .eq('id', itemId)
    .eq('profile_id', profile.id)
    .select('id, category, title, description, url, visibility')
    .single();

  if (error) return { success: false, error: dbErrorFor('update-profile-item', error) };
  if (!row) return { success: false, error: 'Item not found' };
  revalidatePath('/dashboard/profile');
  return { success: true, item: row as WizardItem };
}

export async function removeProfileItem(itemId: string): Promise<ActionResult> {
  const { user, supabase, error: authError } = await getAuthenticatedUser();
  if (authError) return { success: false, error: authError };

  // KAN-260 — owner-scope the delete in code as well as RLS.
  const profile = await getUserProfile(supabase, user!.id);
  if (!profile) return { success: false, error: 'Profile not found' };

  const { error } = await supabase
    .from('profile_items')
    .delete()
    .eq('id', itemId)
    .eq('profile_id', profile.id);

  if (error) return { success: false, error: dbErrorFor('remove-profile-item', error) };
  revalidatePath('/dashboard/profile');
  return { success: true };
}

/**
 * KAN-443 — "not for me": hide one auto-generated gift suggestion.
 *
 * Until now a member could add and remove their OWN gift ideas but could do
 * nothing at all about the ones Lyra generates for them — a suggestion that
 * misread them sat on their public profile permanently. This is the smallest
 * honest answer: one row saying "not this one", and it stays gone.
 *
 * `suggestionKey` identifies a CONCEPT, not a product — see
 * `src/lib/recommend/dismissals.ts` for why. It is machine-generated by the
 * caller, never typed by a member, so it is sanitised and length-capped here
 * purely as defence in depth: a server action is a public endpoint and the
 * argument is whatever the client sends.
 *
 * Same shape as the neighbouring writes: authenticate, rate-limit (KAN-231),
 * then owner-scope by profile_id in code as well as by RLS (KAN-260).
 */
export async function dismissGiftSuggestion(suggestionKey: string): Promise<ActionResult> {
  const { user, supabase, error: authError } = await getAuthenticatedUser();
  if (authError) return { success: false, error: authError };

  // KAN-231 — profile-save rate limiting. A dismissal is a user-driven write,
  // and it is the one write here that a script could issue in a tight loop, so
  // this also caps how many rows one member can accumulate.
  const rl = await checkProfileWriteRateLimit(user!.id);
  if (!rl.allowed) return rl.result;

  const profile = await getUserProfile(supabase, user!.id);
  if (!profile) return { success: false, error: 'Profile not found' };

  const key = sanitiseText(suggestionKey, MAX_SUGGESTION_KEY_LENGTH);
  if (key === '') return { success: false, error: 'Nothing to hide' };

  // Dismissing something already dismissed is a no-op, not an error — the
  // member may have two tabs open, or double-clicked. `ignoreDuplicates` makes
  // the write idempotent rather than returning a primary-key violation.
  const { error } = await supabase
    .from('gift_suggestion_dismissals')
    .upsert(
      { profile_id: profile.id, suggestion_key: key },
      { onConflict: 'profile_id,suggestion_key', ignoreDuplicates: true },
    );

  if (error) return { success: false, error: dbErrorFor('dismiss-gift-suggestion', error) };
  revalidatePath('/dashboard/profile');
  return { success: true };
}

/**
 * KAN-443 — undo a dismissal, so "not for me" is not a one-way door.
 *
 * Scoped by profile_id AND suggestion_key so the delete can only ever remove
 * the caller's own row, even if a DB policy were misconfigured (KAN-260).
 */
export async function restoreGiftSuggestion(suggestionKey: string): Promise<ActionResult> {
  const { user, supabase, error: authError } = await getAuthenticatedUser();
  if (authError) return { success: false, error: authError };

  const rl = await checkProfileWriteRateLimit(user!.id);
  if (!rl.allowed) return rl.result;

  const profile = await getUserProfile(supabase, user!.id);
  if (!profile) return { success: false, error: 'Profile not found' };

  const key = sanitiseText(suggestionKey, MAX_SUGGESTION_KEY_LENGTH);
  if (key === '') return { success: false, error: 'Nothing to bring back' };

  const { error } = await supabase
    .from('gift_suggestion_dismissals')
    .delete()
    .eq('profile_id', profile.id)
    .eq('suggestion_key', key);

  if (error) return { success: false, error: dbErrorFor('restore-gift-suggestion', error) };
  revalidatePath('/dashboard/profile');
  return { success: true };
}

export async function addSchoolAffiliation(data: {
  school_name: string;
  school_location?: string;
  // KAN-451: a short note added at the same time as the affiliation
  // ("Year 2 teacher"). Optional; the edit path (updateSchoolAffiliation)
  // has carried it since KAN-448 and gets identical sanitise + moderation
  // treatment here, so a member cannot use the add path to write something
  // the edit path would refuse.
  description?: string;
  relationship?: string;
  // KAN-220: one of school|organisation|community. Defaults to 'school'
  // for backward compat with pre-KAN-220 callers; coerced on write so
  // anything outside the allowlist becomes 'school' rather than reaching
  // the DB and triggering the CHECK constraint.
  affiliation_type?: string;
}): Promise<ActionResult> {
  const { user, supabase, error: authError } = await getAuthenticatedUser();
  if (authError) return { success: false, error: authError };

  // KAN-231 — profile-save rate limiting.
  const rl = await checkProfileWriteRateLimit(user!.id);
  if (!rl.allowed) return rl.result;

  const profile = await getUserProfile(supabase, user!.id);
  if (!profile) return { success: false, error: 'Profile not found' };

  // KAN-404 — schools must carry a postcode (full or partial) so people can
  // tell schools with the same name apart; orgs/communities keep location
  // optional. Enforced server-side (the real boundary) BEFORE moderation or
  // insert. Coerce the type first so a school smuggled in as something else
  // still hits this gate.
  const affiliationType = coerceAffiliationType(data.affiliation_type);
  if (requiresPostcode(affiliationType) && !isSchoolPostcodeValid(data.school_location)) {
    return {
      success: false,
      error: 'Schools need a postcode (full or partial) so people can tell schools with the same name apart.',
    };
  }

  // KAN-241 + KAN-244 — content moderation + audit log. Affiliations
  // show on the public profile.
  const sanitisedName = sanitiseText(data.school_name, 200);
  const sanitisedLoc = data.school_location
    ? sanitiseText(data.school_location, 200)
    : null;
  // KAN-451 — same 200-char cap and empty-means-NULL rule as the edit path.
  const sanitisedDesc = data.description && data.description.trim() !== ''
    ? sanitiseText(data.description, 200)
    : null;
  const nameMod = await moderateAndAudit(supabase, {
    text: sanitisedName,
    fieldType: 'public',
    field: 'school_affiliations.school_name',
    profileId: profile.id,
    source: 'web_app',
  });
  if (!nameMod.ok) return { success: false, error: nameMod.error };
  if (sanitisedLoc) {
    const locMod = await moderateAndAudit(supabase, {
      text: sanitisedLoc,
      fieldType: 'public',
      field: 'school_affiliations.school_location',
      profileId: profile.id,
      source: 'web_app',
    });
    if (!locMod.ok) return { success: false, error: locMod.error };
  }
  if (sanitisedDesc) {
    const descMod = await moderateAndAudit(supabase, {
      text: sanitisedDesc,
      fieldType: 'public',
      field: 'school_affiliations.description',
      profileId: profile.id,
      source: 'web_app',
    });
    if (!descMod.ok) return { success: false, error: descMod.error };
  }

  const { error } = await supabase
    .from('school_affiliations')
    .insert({
      profile_id: profile.id,
      school_name: sanitisedName,
      school_location: sanitisedLoc,
      description: sanitisedDesc,
      relationship: data.relationship || 'parent',
      affiliation_type: affiliationType,
    });

  if (error) return { success: false, error: dbErrorFor('add-school-affiliation', error) };
  revalidatePath('/dashboard/profile');
  return { success: true };
}

/**
 * KAN-448 — edit an existing affiliation's name / location / description.
 * Mirrors `addSchoolAffiliation` for sanitise + moderation and the KAN-404
 * postcode rule, and `updateProfileItem` for the partial-update shape: only
 * the fields the caller passes are written, so an omitted field keeps its
 * stored value (BUGS-74). `affiliation_type` is deliberately NOT editable
 * here — the row's stored type is what decides whether a postcode is required.
 *
 * KAN-451's schools picker will reuse this action and supplies a school
 * description and location alongside the name, so the signature already
 * carries both and won't need changing.
 */
export async function updateSchoolAffiliation(
  affiliationId: string,
  data: { school_name?: string; school_location?: string; description?: string },
): Promise<ActionResult> {
  const { user, supabase, error: authError } = await getAuthenticatedUser();
  if (authError) return { success: false, error: authError };

  // KAN-231 — profile-save rate limiting (edits are user-driven writes too).
  const rl = await checkProfileWriteRateLimit(user!.id);
  if (!rl.allowed) return rl.result;

  // KAN-260 — belt-and-braces ownership: scope both the read and the write to
  // the caller's own profile in code, not by RLS alone.
  const profile = await getUserProfile(supabase, user!.id);
  if (!profile) return { success: false, error: 'Profile not found' };

  const { data: current } = await supabase
    .from('school_affiliations')
    .select('affiliation_type')
    .eq('id', affiliationId)
    .eq('profile_id', profile.id)
    .maybeSingle();

  if (!current) return { success: false, error: 'Affiliation not found' };

  // KAN-404 — a school must still carry a postcode after an edit, so a member
  // can't clear it by editing. Only checked when the caller is actually
  // changing the location; the stored type decides, not a caller-supplied one.
  const affiliationType = coerceAffiliationType(
    (current as { affiliation_type?: string }).affiliation_type,
  );
  if (
    data.school_location !== undefined
    && requiresPostcode(affiliationType)
    && !isSchoolPostcodeValid(data.school_location)
  ) {
    return {
      success: false,
      error: 'Schools need a postcode (full or partial) so people can tell schools with the same name apart.',
    };
  }

  const updates: Record<string, string | null> = {};

  if (data.school_name !== undefined) {
    const sanitisedName = sanitiseText(data.school_name, 200);
    if (sanitisedName.trim() === '') {
      return { success: false, error: 'Name cannot be empty' };
    }
    const nameMod = await moderateAndAudit(supabase, {
      text: sanitisedName,
      fieldType: 'public',
      field: 'school_affiliations.school_name',
      profileId: profile.id,
      source: 'web_app',
    });
    if (!nameMod.ok) return { success: false, error: nameMod.error };
    updates.school_name = sanitisedName;
  }

  if (data.school_location !== undefined) {
    // Empty string clears the location to NULL (mirrors the add path, where an
    // absent location is inserted as NULL).
    const sanitisedLoc = data.school_location.trim() !== ''
      ? sanitiseText(data.school_location, 200)
      : null;
    if (sanitisedLoc) {
      const locMod = await moderateAndAudit(supabase, {
        text: sanitisedLoc,
        fieldType: 'public',
        field: 'school_affiliations.school_location',
        profileId: profile.id,
        source: 'web_app',
      });
      if (!locMod.ok) return { success: false, error: locMod.error };
    }
    updates.school_location = sanitisedLoc;
  }

  if (data.description !== undefined) {
    const sanitisedDesc = data.description.trim() !== ''
      ? sanitiseText(data.description, 200)
      : null;
    if (sanitisedDesc) {
      const descMod = await moderateAndAudit(supabase, {
        text: sanitisedDesc,
        fieldType: 'public',
        field: 'school_affiliations.description',
        profileId: profile.id,
        source: 'web_app',
      });
      if (!descMod.ok) return { success: false, error: descMod.error };
    }
    updates.description = sanitisedDesc;
  }

  // Empty-patch guard — no-op rather than firing an UPDATE with empty SET.
  if (Object.keys(updates).length === 0) return { success: true };

  const { error } = await supabase
    .from('school_affiliations')
    .update(updates)
    .eq('id', affiliationId)
    .eq('profile_id', profile.id);

  if (error) return { success: false, error: dbErrorFor('update-school-affiliation', error) };
  revalidatePath('/dashboard/profile');
  return { success: true };
}

export async function removeSchoolAffiliation(affiliationId: string): Promise<ActionResult> {
  const { user, supabase, error: authError } = await getAuthenticatedUser();
  if (authError) return { success: false, error: authError };

  // KAN-260 — owner-scope the delete in code as well as RLS.
  const profile = await getUserProfile(supabase, user!.id);
  if (!profile) return { success: false, error: 'Profile not found' };

  const { error } = await supabase
    .from('school_affiliations')
    .delete()
    .eq('id', affiliationId)
    .eq('profile_id', profile.id);

  if (error) return { success: false, error: dbErrorFor('remove-school-affiliation', error) };
  revalidatePath('/dashboard/profile');
  return { success: true };
}

// KAN-267 — affiliations are hidden on the public profile unless the owner
// opts the row in. Toggling `show_on_profile` is owner-scoped in code as well
// as RLS (same defence-in-depth pattern as removeSchoolAffiliation).
export async function updateAffiliationVisibility(
  affiliationId: string,
  showOnProfile: boolean,
): Promise<ActionResult> {
  const { user, supabase, error: authError } = await getAuthenticatedUser();
  if (authError) return { success: false, error: authError };

  const profile = await getUserProfile(supabase, user!.id);
  if (!profile) return { success: false, error: 'Profile not found' };

  const { error } = await supabase
    .from('school_affiliations')
    .update({ show_on_profile: showOnProfile })
    .eq('id', affiliationId)
    .eq('profile_id', profile.id);

  if (error) return { success: false, error: dbErrorFor('update-affiliation-visibility', error) };
  revalidatePath('/dashboard/profile');
  return { success: true };
}

export async function addExternalLink(data: {
  title: string;
  url: string;
  link_type?: string;
  // KAN-447 — `external_links.description` has existed since the first schema
  // migration but nothing ever wrote it. Optional; absent or empty → NULL.
  description?: string;
}): Promise<ActionResult> {
  const { user, supabase, error: authError } = await getAuthenticatedUser();
  if (authError) return { success: false, error: authError };

  // KAN-231 — profile-save rate limiting.
  const rl = await checkProfileWriteRateLimit(user!.id);
  if (!rl.allowed) return rl.result;

  const profile = await getUserProfile(supabase, user!.id);
  if (!profile) return { success: false, error: 'Profile not found' };

  const sanitisedUrl = sanitiseUrl(data.url);
  if (!sanitisedUrl) return { success: false, error: 'Invalid URL — must start with http:// or https://' };

  // KAN-241 + KAN-244 — content moderation + audit log on link title.
  // The URL itself is already sanitiseUrl-restricted to http(s); only
  // the user-visible title needs the wordlist + PII pass.
  const sanitisedLinkTitle = sanitiseText(data.title, 200);
  const linkTitleMod = await moderateAndAudit(supabase, {
    text: sanitisedLinkTitle,
    fieldType: 'public',
    field: 'external_links.title',
    profileId: profile.id,
    source: 'web_app',
  });
  if (!linkTitleMod.ok) return { success: false, error: linkTitleMod.error };

  // KAN-447 — the optional one-line description shown next to the title.
  const sanitisedDesc = data.description && data.description.trim() !== ''
    ? sanitiseText(data.description, 200)
    : null;
  if (sanitisedDesc) {
    const descMod = await moderateAndAudit(supabase, {
      text: sanitisedDesc,
      fieldType: 'public',
      field: 'external_links.description',
      profileId: profile.id,
      source: 'web_app',
    });
    if (!descMod.ok) return { success: false, error: descMod.error };
  }

  const { error } = await supabase
    .from('external_links')
    .insert({
      profile_id: profile.id,
      title: sanitisedLinkTitle,
      url: sanitisedUrl,
      link_type: data.link_type || 'general',
      description: sanitisedDesc,
    });

  if (error) return { success: false, error: dbErrorFor('add-external-link', error) };
  revalidatePath('/dashboard/profile');
  return { success: true };
}

/**
 * KAN-447 — edit an existing link's title / description / url. Mirrors
 * `addExternalLink` for sanitise + moderation and `updateProfileItem` for the
 * partial-update shape: only the fields the caller passes are written, and an
 * empty description clears it to NULL so a member can remove a description via
 * edit, not only replace it. The URL is required on a link, so an empty one is
 * an error rather than a clear. `link_type` is intentionally NOT editable here
 * (text-only edit — changing the type is a separate concern).
 */
export async function updateExternalLink(
  linkId: string,
  data: { title?: string; url?: string; description?: string },
): Promise<ActionResult> {
  const { user, supabase, error: authError } = await getAuthenticatedUser();
  if (authError) return { success: false, error: authError };

  // KAN-231 — profile-save rate limiting (edits are user-driven writes too).
  const rl = await checkProfileWriteRateLimit(user!.id);
  if (!rl.allowed) return rl.result;

  // KAN-260 — belt-and-braces ownership: scope the write to the caller's own
  // profile in code, not by RLS alone.
  const profile = await getUserProfile(supabase, user!.id);
  if (!profile) return { success: false, error: 'Profile not found' };

  const updates: Record<string, string | null> = {};

  if (data.title !== undefined) {
    const sanitisedTitle = sanitiseText(data.title, 200);
    if (sanitisedTitle.trim() === '') {
      return { success: false, error: 'Title cannot be empty' };
    }
    const titleMod = await moderateAndAudit(supabase, {
      text: sanitisedTitle,
      fieldType: 'public',
      field: 'external_links.title',
      profileId: profile.id,
      source: 'web_app',
    });
    if (!titleMod.ok) return { success: false, error: titleMod.error };
    updates.title = sanitisedTitle;
  }

  if (data.description !== undefined) {
    const sanitisedDesc = data.description.trim() !== ''
      ? sanitiseText(data.description, 200)
      : null;
    if (sanitisedDesc) {
      const descMod = await moderateAndAudit(supabase, {
        text: sanitisedDesc,
        fieldType: 'public',
        field: 'external_links.description',
        profileId: profile.id,
        source: 'web_app',
      });
      if (!descMod.ok) return { success: false, error: descMod.error };
    }
    updates.description = sanitisedDesc;
  }

  if (data.url !== undefined) {
    const cleaned = sanitiseUrl(data.url);
    if (!cleaned) return { success: false, error: 'Invalid URL — must start with http:// or https://' };
    updates.url = cleaned;
  }

  // Empty-patch guard — no-op rather than firing an UPDATE with empty SET.
  if (Object.keys(updates).length === 0) return { success: true };

  const { error } = await supabase
    .from('external_links')
    .update(updates)
    .eq('id', linkId)
    .eq('profile_id', profile.id);

  if (error) return { success: false, error: dbErrorFor('update-external-link', error) };
  revalidatePath('/dashboard/profile');
  return { success: true };
}

export async function removeExternalLink(linkId: string): Promise<ActionResult> {
  const { user, supabase, error: authError } = await getAuthenticatedUser();
  if (authError) return { success: false, error: authError };

  // KAN-260 — owner-scope the delete in code as well as RLS.
  const profile = await getUserProfile(supabase, user!.id);
  if (!profile) return { success: false, error: 'Profile not found' };

  const { error } = await supabase
    .from('external_links')
    .delete()
    .eq('id', linkId)
    .eq('profile_id', profile.id);

  if (error) return { success: false, error: dbErrorFor('remove-external-link', error) };
  revalidatePath('/dashboard/profile');
  return { success: true };
}

/**
 * KAN-221 Phase 3 — Hybrid section + item visibility.
 *
 * Writes a single section's default visibility into the
 * `profiles.section_visibility` JSONB column. Items in that section
 * whose own `visibility` is unset will inherit this default at render
 * time (see `getEffectiveItemVisibility` in `section-visibility.ts`).
 *
 * Two-step read-modify-write because Postgres JSONB doesn't support
 * partial in-place updates atomically without a trip via the application
 * for the merge. Acceptable race window because section_visibility is
 * a single-user-per-row decision (their own profile) — no concurrent
 * writers in practice.
 *
 * The section key is checked against `CONTROLLABLE_SECTION_KEYS` to
 * prevent arbitrary keys ending up in the JSONB column (defence in
 * depth — `coerceSectionVisibility` on read also drops unknowns, but
 * keeping bad data out at write-time is cheaper than filtering on
 * every read).
 */
export async function updateSectionVisibility(
  sectionKey: string,
  visibility: string,
): Promise<ActionResult> {
  const { user, supabase, error: authError } = await getAuthenticatedUser();
  if (authError) return { success: false, error: authError };

  if (!isControllableSectionKey(sectionKey)) {
    return { success: false, error: `Unknown section: ${sectionKey}` };
  }

  // coerceVisibility falls back to 'public' on unknown values — matches
  // KAN-143's behaviour for per-item visibility writes.
  const coerced = coerceVisibility(visibility);

  // Read current section_visibility, merge in the new section key,
  // write back.
  const { data: profile } = await supabase
    .from('profiles')
    .select('section_visibility')
    .eq('user_id', user!.id)
    .single();

  const currentSV = coerceSectionVisibility(
    (profile as { section_visibility?: unknown } | null)?.section_visibility,
  );
  const nextSV: SectionVisibility = { ...currentSV, [sectionKey]: coerced };

  const { error } = await supabase
    .from('profiles')
    .update({ section_visibility: nextSV })
    .eq('user_id', user!.id);

  if (error) return { success: false, error: dbErrorFor('update-section-visibility', error) };
  revalidatePath('/dashboard/profile');
  // Also revalidate the public profile path so the change shows up
  // immediately on the next visit.
  if (profile) {
    // We don't have the slug here without an extra query — revalidate
    // the dashboard and the profile slug pages broadly via tag.
    revalidatePath('/dashboard');
  }
  return { success: true };
}

export async function publishProfile(): Promise<ActionResult> {
  const { user, supabase, error: authError } = await getAuthenticatedUser();
  if (authError) return { success: false, error: authError };

  // Age is established by the 18+ self-declaration at sign-up. KAN-408: where an
  // admin has turned the `age_verification` global switch ON for this
  // environment, ALSO require a passed provider (Didit) check before publishing.
  if (await isProviderAgeCheckActive()) {
    const { data: ageRow } = await supabase
      .from('profiles')
      .select('age_status')
      .eq('user_id', user!.id)
      .maybeSingle();
    if (!passedProviderAgeCheck((ageRow as { age_status?: string } | null)?.age_status)) {
      return { success: false, error: AGE_GATE_BLOCK_MESSAGE };
    }
  }

  const { error } = await supabase
    .from('profiles')
    .update({ is_published: true, onboarding_complete: true })
    .eq('user_id', user!.id);

  if (error) return { success: false, error: dbErrorFor('publish-profile', error) };
  revalidatePath('/dashboard/profile');
  revalidatePath('/dashboard');
  return { success: true };
}

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export async function uploadAvatar(formData: FormData): Promise<ActionResult> {
  const { user, supabase, error: authError } = await getAuthenticatedUser();
  if (authError) return { success: false, error: authError };

  // KAN-309 — per-user feature gate (media_uploads covers profile photos too;
  // default on, an admin can revoke). Mirrors uploadProfileFile.
  const features = await getMyFeatureEntitlements();
  if (!features.media_uploads) {
    return { success: false, error: 'Media uploads are not enabled for your account.' };
  }

  // KAN-231 — profile-save rate limiting (avatars are user-driven writes too).
  const rl = await checkProfileWriteRateLimit(user!.id);
  if (!rl.allowed) return rl.result;

  const file = formData.get('avatar') as File | null;

  // SEC-52 — shared preflight: presence, 5MB cap, allowed image MIME AND
  // magic-byte signature. The declared MIME is browser-controlled and
  // trivially spoofable, so a spoofed-MIME/polyglot must be rejected here
  // before it reaches the world-readable profile-photos bucket. This is the
  // SAME helper uploadProfileFile uses so the two paths can't drift.
  const preflightError = await preflightUpload(file, {
    allowedMimes: ALLOWED_IMAGE_TYPES,
    maxBytes: MAX_FILE_SIZE,
    emptyMessage: 'No file provided',
    typeMessage: 'Invalid file type. Allowed: JPEG, PNG, WebP, GIF',
    sizeMessage: 'File too large. Maximum size is 5MB',
  });
  if (preflightError) return { success: false, error: preflightError };
  // preflightUpload guarantees a present, valid File past this point.
  const avatar = file as File;

  // Determine extension from MIME type
  const extMap: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  };
  const ext = extMap[avatar.type] || 'jpg';
  const filePath = `${user!.id}/avatar.${ext}`;

  // Upload to Supabase Storage (upsert to overwrite existing)
  const { error: uploadError } = await supabase.storage
    .from('profile-photos')
    .upload(filePath, avatar, { upsert: true, contentType: avatar.type });

  if (uploadError) return { success: false, error: uploadError.message };

  // Get public URL
  const { data: urlData } = supabase.storage
    .from('profile-photos')
    .getPublicUrl(filePath);

  // Update profile with avatar URL
  const { error: updateError } = await supabase
    .from('profiles')
    .update({ avatar_url: urlData.publicUrl })
    .eq('user_id', user!.id);

  if (updateError) return { success: false, error: updateError.message };

  revalidatePath('/dashboard/profile');
  revalidatePath('/dashboard');
  return { success: true };
}
