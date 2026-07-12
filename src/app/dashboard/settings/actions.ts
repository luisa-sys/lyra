'use server';

import { createClient } from '@/lib/supabase-server';
import { getAdminServiceClient } from '@/lib/admin';
import { getAccountStanding, shouldRefuseIssuance } from '@/lib/account-status';
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

  const userId = user.id;

  // True erasure (GDPR). Hard-delete the auth user with the service-role
  // client: profiles.user_id -> auth.users(id) is ON DELETE CASCADE, and
  // every profile-owned table cascades from profiles(id), so this removes
  // ALL of the person's data in one step — profile, items, links, schools,
  // files, manual-of-me, conversation starters, moderation reports, api
  // keys, oauth tokens, convene rows. (The previous version only deleted
  // the profile and left the auth user, and their email, behind.)
  const admin = getAdminServiceClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    // The only expected failure is an account that has performed moderation/
    // admin actions: moderation_logs.actor_user_id is ON DELETE RESTRICT and
    // the log is append-only + tamper-evident (SEC-64), so the auth-user
    // delete is blocked by those audit rows. Per SEC-75 (UK-GDPR Art.17(3)(b),
    // retention for a legal obligation), the moderation audit trail — and the
    // actor identity it references — is retained as a documented, time-limited
    // erasure exception (see docs/compliance/RETENTION_SCHEDULE.md +
    // DSAR_BREACH_COMPLAINTS.md). Don't half-delete anything; route the person
    // to the privacy inbox, which erases everything lawful and records what
    // must be retained and why.
    return redirect(
      '/dashboard/settings?error=' +
        encodeURIComponent(
          'Your account includes moderation/admin audit records we are legally required to keep, so it cannot be deleted automatically. Please email privacy@checklyra.com — we will erase everything we lawfully can and explain what must be retained.',
        ),
    );
  }

  // Best-effort: remove now-orphaned storage objects (the DB cascade
  // doesn't touch storage). Non-fatal — the account and all rows are gone.
  for (const bucket of ['profile-photos', 'profile-files']) {
    try {
      const { data: files } = await admin.storage.from(bucket).list(userId);
      if (files?.length) {
        await admin.storage.from(bucket).remove(files.map((f) => `${userId}/${f.name}`));
      }
    } catch {
      // ignore — orphaned-object cleanup isn't worth failing the flow
    }
  }

  // Clear the now-invalid session cookie and send them home.
  await supabase.auth.signOut();
  redirect('/');
}

export async function generateApiKey(name: string = 'Default'): Promise<{ key?: string; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  // SEC-57: refuse to mint credentials for a suspended (or unverifiable)
  // account. Fail closed — a suspended user must not be able to obtain a new
  // MCP API key even if they reach this action directly (the middleware
  // redirect that normally catches them fails open on a lookup error).
  const standing = await getAccountStanding(supabase, user.id);
  if (shouldRefuseIssuance(standing)) {
    return { error: 'Your account is suspended. API keys cannot be generated.' };
  }

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
