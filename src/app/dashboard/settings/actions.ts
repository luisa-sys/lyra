'use server';

import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';

export async function exportUserData() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (!profile) throw new Error('Profile not found');

  const { data: items } = await supabase
    .from('profile_items')
    .select('*')
    .eq('profile_id', profile.id);

  const { data: schools } = await supabase
    .from('school_affiliations')
    .select('*')
    .eq('profile_id', profile.id);

  const { data: links } = await supabase
    .from('external_links')
    .select('*')
    .eq('profile_id', profile.id);

  return JSON.stringify({
    exported_at: new Date().toISOString(),
    account: { email: user.email, created_at: user.created_at },
    profile,
    items: items || [],
    schools: schools || [],
    links: links || [],
  }, null, 2);
}

export async function deleteAccount() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Delete profile and all related data (cascade handles items, schools, links)
  await supabase.from('profiles').delete().eq('user_id', user.id);

  // Delete the auth user (requires service role, but user can delete themselves)
  // Note: Supabase doesn't allow users to delete their own auth record via client SDK
  // We mark the profile as deleted; full auth cleanup requires a Supabase Edge Function or admin action
  // For now, sign out the user
  await supabase.auth.signOut();
  redirect('/');
}
