'use server';

import { createClient } from '@/lib/supabase-server';
import { revalidatePath } from 'next/cache';
import { sanitiseText, sanitiseUrl, type ActionResult } from '@/lib/sanitise';
import { moderateAndAudit } from '@/lib/moderation-audit';
import { checkProfileWriteRateLimit } from '@/lib/profile-rate-limit';
import { isAllowedProfileField } from './profile-fields';
import { coerceVisibility } from './visibility';
import { coerceAffiliationType } from './affiliation-fields';
import {
  coerceSectionVisibility,
  isControllableSectionKey,
  type SectionVisibility,
} from './section-visibility';

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

  const { error } = await supabase
    .from('profiles')
    .update(sanitised)
    .eq('user_id', user!.id);

  if (error) return { success: false, error: error.message };
  revalidatePath('/dashboard/profile');
  return { success: true };
}

export async function addProfileItem(data: {
  category: string;
  title: string;
  description?: string;
  url?: string;
  visibility?: string;
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

  const { error } = await supabase
    .from('profile_items')
    .insert({
      profile_id: profile.id,
      category: sanitiseText(data.category, 50),
      title: sanitisedTitle,
      description: sanitisedDesc,
      url: sanitisedUrl,
      visibility,
    });

  if (error) return { success: false, error: error.message };
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

  if (error) return { success: false, error: error.message };
  revalidatePath('/dashboard/profile');
  return { success: true };
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

  if (error) return { success: false, error: error.message };
  revalidatePath('/dashboard/profile');
  return { success: true };
}

export async function addSchoolAffiliation(data: {
  school_name: string;
  school_location?: string;
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

  // KAN-241 + KAN-244 — content moderation + audit log. Affiliations
  // show on the public profile.
  const sanitisedName = sanitiseText(data.school_name, 200);
  const sanitisedLoc = data.school_location
    ? sanitiseText(data.school_location, 200)
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

  const { error } = await supabase
    .from('school_affiliations')
    .insert({
      profile_id: profile.id,
      school_name: sanitisedName,
      school_location: sanitisedLoc,
      relationship: data.relationship || 'parent',
      affiliation_type: coerceAffiliationType(data.affiliation_type),
    });

  if (error) return { success: false, error: error.message };
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

  if (error) return { success: false, error: error.message };
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

  if (error) return { success: false, error: error.message };
  revalidatePath('/dashboard/profile');
  return { success: true };
}

export async function addExternalLink(data: {
  title: string;
  url: string;
  link_type?: string;
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

  const { error } = await supabase
    .from('external_links')
    .insert({
      profile_id: profile.id,
      title: sanitisedLinkTitle,
      url: sanitisedUrl,
      link_type: data.link_type || 'general',
    });

  if (error) return { success: false, error: error.message };
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

  if (error) return { success: false, error: error.message };
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

  if (error) return { success: false, error: error.message };
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

  const { error } = await supabase
    .from('profiles')
    .update({ is_published: true, onboarding_complete: true })
    .eq('user_id', user!.id);

  if (error) return { success: false, error: error.message };
  revalidatePath('/dashboard/profile');
  revalidatePath('/dashboard');
  return { success: true };
}

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export async function uploadAvatar(formData: FormData): Promise<ActionResult> {
  const { user, supabase, error: authError } = await getAuthenticatedUser();
  if (authError) return { success: false, error: authError };

  // KAN-231 — profile-save rate limiting (avatars are user-driven writes too).
  const rl = await checkProfileWriteRateLimit(user!.id);
  if (!rl.allowed) return rl.result;

  const file = formData.get('avatar') as File | null;
  if (!file || file.size === 0) return { success: false, error: 'No file provided' };

  // Validate MIME type server-side
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return { success: false, error: 'Invalid file type. Allowed: JPEG, PNG, WebP, GIF' };
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    return { success: false, error: 'File too large. Maximum size is 5MB' };
  }

  // Determine extension from MIME type
  const extMap: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  };
  const ext = extMap[file.type] || 'jpg';
  const filePath = `${user!.id}/avatar.${ext}`;

  // Upload to Supabase Storage (upsert to overwrite existing)
  const { error: uploadError } = await supabase.storage
    .from('profile-photos')
    .upload(filePath, file, { upsert: true, contentType: file.type });

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
