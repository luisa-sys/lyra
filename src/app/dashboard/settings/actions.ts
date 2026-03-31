'use server';

import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import { randomBytes, createHash } from 'crypto';

function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export async function exportUserData(): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return JSON.stringify({ error: 'Not authenticated' });

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (!profile) return JSON.stringify({ error: 'Profile not found' });

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

  const { data: apiKeys } = await supabase
    .from('api_keys')
    .select('id, key_prefix, name, created_at, last_used_at, revoked_at')
    .eq('user_id', user.id);

  return JSON.stringify({
    exported_at: new Date().toISOString(),
    account: { email: user.email, created_at: user.created_at },
    profile,
    items: items || [],
    schools: schools || [],
    links: links || [],
    api_keys: apiKeys || [],
  }, null, 2);
}

export async function deleteAccount() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirect('/login');

  // Delete api_keys (not cascaded via profile FK)
  await supabase.from('api_keys').delete().eq('user_id', user.id);

  // Delete profile photo from storage
  const { data: profile } = await supabase
    .from('profiles')
    .select('avatar_url')
    .eq('user_id', user.id)
    .single();

  if (profile?.avatar_url) {
    const path = `${user.id}/`;
    await supabase.storage.from('profile-photos').list(path).then(({ data: files }) => {
      if (files?.length) {
        const paths = files.map(f => `${path}${f.name}`);
        supabase.storage.from('profile-photos').remove(paths);
      }
    });
  }

  // Delete profile (cascades to profile_items, external_links, school_affiliations)
  await supabase.from('profiles').delete().eq('user_id', user.id);

  // Sign out (Supabase Auth user remains but profile data is gone)
  await supabase.auth.signOut();
  redirect('/');
}

export async function generateApiKey(name: string = 'Default'): Promise<{ key?: string; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  // Generate a secure random API key
  const rawKey = `lyra_${randomBytes(24).toString('base64url')}`;
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.substring(0, 12);

  const { error } = await supabase.from('api_keys').insert({
    user_id: user.id,
    key_hash: keyHash,
    key_prefix: keyPrefix,
    name,
  });

  if (error) return { error: error.message };

  // Return the raw key — this is the ONLY time it's visible
  return { key: rawKey };
}

export async function listApiKeys(): Promise<{ keys?: Array<{ id: string; key_prefix: string; name: string; created_at: string; last_used_at: string | null }>; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const { data, error } = await supabase
    .from('api_keys')
    .select('id, key_prefix, name, created_at, last_used_at')
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });

  if (error) return { error: error.message };
  return { keys: data || [] };
}

export async function revokeApiKey(keyId: string): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const { error } = await supabase
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('user_id', user.id);

  if (error) return { error: error.message };
  return { success: true };
}

export async function updateEmail(newEmail: string): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const { error } = await supabase.auth.updateUser({
    email: newEmail,
  });

  if (error) return { error: error.message };
  return { success: true };
}

export async function updatePassword(currentPassword: string, newPassword: string): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  if (newPassword.length < 6) return { error: 'New password must be at least 6 characters' };

  // Verify current password by re-authenticating
  if (user.email) {
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (signInError) return { error: 'Current password is incorrect' };
  }

  const { error } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (error) return { error: error.message };
  return { success: true };
}
