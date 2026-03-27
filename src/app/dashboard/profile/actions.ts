'use server';

import { createClient } from '@/lib/supabase-server';
import { revalidatePath } from 'next/cache';

export async function updateProfile(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const field = formData.get('field') as string;
  const value = formData.get('value') as string;

  const { error } = await supabase
    .from('profiles')
    .update({ [field]: value })
    .eq('user_id', user.id);

  if (error) throw new Error(error.message);
  revalidatePath('/dashboard/profile');
}

export async function updateProfileFields(data: Record<string, string | boolean | number | null>) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('profiles')
    .update(data)
    .eq('user_id', user.id);

  if (error) throw new Error(error.message);
  revalidatePath('/dashboard/profile');
}

export async function addProfileItem(data: {
  category: string;
  title: string;
  description?: string;
  visibility?: string;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single();

  if (!profile) throw new Error('Profile not found');

  const { error } = await supabase
    .from('profile_items')
    .insert({
      profile_id: profile.id,
      category: data.category,
      title: data.title,
      description: data.description || null,
      visibility: data.visibility || 'public',
    });

  if (error) throw new Error(error.message);
  revalidatePath('/dashboard/profile');
}

export async function removeProfileItem(itemId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('profile_items')
    .delete()
    .eq('id', itemId);

  if (error) throw new Error(error.message);
  revalidatePath('/dashboard/profile');
}

export async function addSchoolAffiliation(data: {
  school_name: string;
  school_location?: string;
  relationship?: string;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single();

  if (!profile) throw new Error('Profile not found');

  const { error } = await supabase
    .from('school_affiliations')
    .insert({
      profile_id: profile.id,
      school_name: data.school_name,
      school_location: data.school_location || null,
      relationship: data.relationship || 'parent',
    });

  if (error) throw new Error(error.message);
  revalidatePath('/dashboard/profile');
}

export async function removeSchoolAffiliation(affiliationId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('school_affiliations')
    .delete()
    .eq('id', affiliationId);

  if (error) throw new Error(error.message);
  revalidatePath('/dashboard/profile');
}

export async function addExternalLink(data: {
  title: string;
  url: string;
  link_type?: string;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single();

  if (!profile) throw new Error('Profile not found');

  const { error } = await supabase
    .from('external_links')
    .insert({
      profile_id: profile.id,
      title: data.title,
      url: data.url,
      link_type: data.link_type || 'general',
    });

  if (error) throw new Error(error.message);
  revalidatePath('/dashboard/profile');
}

export async function removeExternalLink(linkId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('external_links')
    .delete()
    .eq('id', linkId);

  if (error) throw new Error(error.message);
  revalidatePath('/dashboard/profile');
}

export async function publishProfile() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('profiles')
    .update({ is_published: true, onboarding_complete: true })
    .eq('user_id', user.id);

  if (error) throw new Error(error.message);
  revalidatePath('/dashboard/profile');
  revalidatePath('/dashboard');
}
