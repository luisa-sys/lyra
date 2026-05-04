'use server';

import { createClient } from '@/lib/supabase-server';
import { revalidatePath } from 'next/cache';
import { sanitiseText, sanitiseUrl, type ActionResult } from '@/lib/sanitise';
import { isAllowedProfileField } from './profile-fields';

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
  visibility?: string;
}): Promise<ActionResult> {
  const { user, supabase, error: authError } = await getAuthenticatedUser();
  if (authError) return { success: false, error: authError };

  const profile = await getUserProfile(supabase, user!.id);
  if (!profile) return { success: false, error: 'Profile not found' };

  const { error } = await supabase
    .from('profile_items')
    .insert({
      profile_id: profile.id,
      category: sanitiseText(data.category, 50),
      title: sanitiseText(data.title, 200),
      description: data.description ? sanitiseText(data.description, 1000) : null,
      visibility: data.visibility || 'public',
    });

  if (error) return { success: false, error: error.message };
  revalidatePath('/dashboard/profile');
  return { success: true };
}

export async function removeProfileItem(itemId: string): Promise<ActionResult> {
  const { supabase, error: authError } = await getAuthenticatedUser();
  if (authError) return { success: false, error: authError };

  const { error } = await supabase
    .from('profile_items')
    .delete()
    .eq('id', itemId);

  if (error) return { success: false, error: error.message };
  revalidatePath('/dashboard/profile');
  return { success: true };
}

export async function addSchoolAffiliation(data: {
  school_name: string;
  school_location?: string;
  relationship?: string;
}): Promise<ActionResult> {
  const { user, supabase, error: authError } = await getAuthenticatedUser();
  if (authError) return { success: false, error: authError };

  const profile = await getUserProfile(supabase, user!.id);
  if (!profile) return { success: false, error: 'Profile not found' };

  const { error } = await supabase
    .from('school_affiliations')
    .insert({
      profile_id: profile.id,
      school_name: sanitiseText(data.school_name, 200),
      school_location: data.school_location ? sanitiseText(data.school_location, 200) : null,
      relationship: data.relationship || 'parent',
    });

  if (error) return { success: false, error: error.message };
  revalidatePath('/dashboard/profile');
  return { success: true };
}

export async function removeSchoolAffiliation(affiliationId: string): Promise<ActionResult> {
  const { supabase, error: authError } = await getAuthenticatedUser();
  if (authError) return { success: false, error: authError };

  const { error } = await supabase
    .from('school_affiliations')
    .delete()
    .eq('id', affiliationId);

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

  const profile = await getUserProfile(supabase, user!.id);
  if (!profile) return { success: false, error: 'Profile not found' };

  const sanitisedUrl = sanitiseUrl(data.url);
  if (!sanitisedUrl) return { success: false, error: 'Invalid URL — must start with http:// or https://' };

  const { error } = await supabase
    .from('external_links')
    .insert({
      profile_id: profile.id,
      title: sanitiseText(data.title, 200),
      url: sanitisedUrl,
      link_type: data.link_type || 'general',
    });

  if (error) return { success: false, error: error.message };
  revalidatePath('/dashboard/profile');
  return { success: true };
}

export async function removeExternalLink(linkId: string): Promise<ActionResult> {
  const { supabase, error: authError } = await getAuthenticatedUser();
  if (authError) return { success: false, error: authError };

  const { error } = await supabase
    .from('external_links')
    .delete()
    .eq('id', linkId);

  if (error) return { success: false, error: error.message };
  revalidatePath('/dashboard/profile');
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
