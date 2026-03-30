'use server';

import { createClient } from '@/lib/supabase-server';
import { revalidatePath } from 'next/cache';
import { sanitiseText, sanitiseUrl, type ActionResult } from '@/lib/sanitise';

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

export async function updateProfile(formData: FormData): Promise<ActionResult> {
  const { user, supabase, error: authError } = await getAuthenticatedUser();
  if (authError) return { success: false, error: authError };

  const field = formData.get('field') as string;
  const rawValue = formData.get('value') as string;
  const value = sanitiseText(rawValue);

  const { error } = await supabase
    .from('profiles')
    .update({ [field]: value })
    .eq('user_id', user!.id);

  if (error) return { success: false, error: error.message };
  revalidatePath('/dashboard/profile');
  return { success: true };
}

export async function updateProfileFields(data: Record<string, string | boolean | number | null>): Promise<ActionResult> {
  const { user, supabase, error: authError } = await getAuthenticatedUser();
  if (authError) return { success: false, error: authError };

  // Sanitise string values
  const sanitised: Record<string, string | boolean | number | null> = {};
  for (const [key, val] of Object.entries(data)) {
    sanitised[key] = typeof val === 'string' ? sanitiseText(val) : val;
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
